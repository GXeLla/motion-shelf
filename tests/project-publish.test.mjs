import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../scripts/state.js';
import { normalizeAnimation } from '../scripts/storage.js';
import { buildExportCSS } from '../scripts/animations.js';
import { syncLibraryToProject, pushAnimationToCode } from '../scripts/code.js';

test('publishing skips unchanged files, bounds writes, and recovers safely from failures', async (t) => {
  const previous = { ...state };
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.sessionStorage;
  t.after(() => {
    Object.assign(state, previous);
    globalThis.window = previousWindow;
    globalThis.sessionStorage = previousStorage;
  });
  globalThis.window = { showDirectoryPicker() {}, indexedDB: {} };
  globalThis.sessionStorage = { setItem() {} };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const messages = [];
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  t.mock.method(console, 'error', (...args) => warnings.push(args));

  class Directory {
    files = new Map();
    failures = new Map();
    counts = { opened: 0, read: 0, streams: 0, closed: 0, aborted: 0, removed: 0, listed: 0, active: 0, peak: 0 };
    tick = 1;
    add(name, text) { this.files.set(name, { text, time: this.tick++ }); }
    resetCounts() { for (const key of Object.keys(this.counts)) this.counts[key] = 0; }
    async getFileHandle(name, { create = false } = {}) {
      if (!this.files.has(name)) {
        if (!create) throw new DOMException('Missing', 'NotFoundError');
        this.add(name, '');
      }
      const directory = this;
      return {
        kind: 'file',
        name,
        async getFile() {
          directory.counts.opened++;
          const record = directory.files.get(name);
          if (!record) throw new DOMException('Missing', 'NotFoundError');
          return {
            lastModified: record.time,
            size: new TextEncoder().encode(record.text).length,
            async text() { directory.counts.read++; await sleep(1); return record.text; },
          };
        },
        async createWritable() {
          const stats = directory.counts;
          if (name === 'manifest.json') assert.equal(stats.active, 0, 'manifest must follow all CSS commits');
          stats.streams++;
          stats.active++;
          stats.peak = Math.max(stats.peak, stats.active);
          let text;
          let finished = false;
          const finish = () => { if (!finished) { finished = true; stats.active--; } };
          return {
            async write(value) {
              await sleep(2);
              if (directory.failures.get(name) === 'write') throw new Error('Injected write failure');
              text = value;
            },
            async close() {
              await sleep(2);
              if (directory.failures.get(name) === 'close') throw new Error('Injected close failure');
              directory.add(name, text);
              stats.closed++;
              finish();
            },
            async abort() { stats.aborted++; finish(); },
          };
        },
      };
    }
    async *entries() {
      this.counts.listed++;
      for (const name of this.files.keys()) yield [name, { kind: 'file' }];
    }
    async removeEntry(name) { this.counts.removed++; this.files.delete(name); }
  }

  const directory = new Directory();
  state.projectHandle = {
    name: 'test-project',
    async queryPermission() { return 'granted'; },
    async getDirectoryHandle(name) { assert.equal(name, 'animations'); return directory; },
  };
  state.projectName = 'test-project';
  state.projectPermission = 'granted';
  const create = (id, name = 'Animation ' + id) => normalizeAnimation({
    id, name, animationName: 'motion' + id, css: 'transform-origin: center;',
    keyframes: 'from { opacity: 0; } to { opacity: 1; }', createdAt: 100, updatedAt: 100,
  });
  const progress = [];
  let rendered = 0;
  const callbacks = { showToast: (message) => messages.push(message), render: () => rendered++, onProgress: (value) => progress.push(value) };

  directory.add('same.css', '/* unrelated external CSS */');
  state.animations = [create('a', 'Same'), create('b', 'Same'), ...Array.from({ length: 10 }, (_, i) => create('c' + i))];
  let result = await syncLibraryToProject(state.animations, callbacks);
  assert.equal(result.written, 12);
  assert.equal(result.unchanged, 0);
  assert.deepEqual(result.failures, []);
  assert.equal(result.manifestError, null);
  assert.equal(directory.counts.peak, 4);
  assert.equal(directory.counts.streams, 13);
  assert.equal(directory.counts.listed, 1, 'no project reread after publishing');
  assert.equal(directory.files.get('same.css').text, '/* unrelated external CSS */');
  assert.equal(new Set(state.animations.map((animation) => animation.codeFileName)).size, 12);
  assert.equal(state.animations[0].codeFileName, 'same-3.css');
  assert.equal(state.animations[1].codeFileName, 'same-2.css');
  assert.equal(progress.at(-1).processed, 12);
  const initial = { ...directory.counts };

  directory.resetCounts();
  result = await syncLibraryToProject(state.animations, callbacks);
  assert.equal(result.written, 0);
  assert.equal(result.unchanged, 12);
  assert.equal(directory.counts.streams, 0, 'unchanged repeat does not open writable streams, including manifest');
  assert.equal(directory.counts.read, 13, 'each CSS and manifest read once');
  const repeat = { ...directory.counts };

  directory.resetCounts();
  state.animations[0].css = 'opacity: .8;';
  state.animations[0].codeSynced = false;
  result = await syncLibraryToProject(state.animations, callbacks);
  assert.equal(result.written, 1);
  assert.equal(result.unchanged, 11);
  assert.equal(directory.counts.streams, 1, 'unchanged manifest stays untouched');

  directory.resetCounts();
  directory.files.get(state.animations[0].codeFileName).text += '\n/* external modification */';
  result = await syncLibraryToProject(state.animations, callbacks);
  assert.equal(result.written, 1, 'actual file is checked, not stale synced flag');

  directory.resetCounts();
  await pushAnimationToCode('a', callbacks);
  assert.equal(directory.counts.streams, 0);
  assert.equal(directory.counts.read, 1);
  assert.equal(directory.counts.listed, 0, 'single save does not enumerate/reload the project');

  const existing = state.animations[0];
  const existingBefore = directory.files.get(existing.codeFileName).text;
  existing.css = 'opacity: .6;';
  existing.codeSynced = false;
  directory.failures.set(existing.codeFileName, 'close');
  const failedNew = create('new-fail', 'Fails New');
  state.animations.push(failedNew);
  directory.failures.set('fails-new.css', 'write');
  directory.resetCounts();
  result = await syncLibraryToProject(state.animations, callbacks);
  assert.equal(result.failures.length, 2);
  assert.equal(result.processed, 13);
  assert.equal(progress.at(-1).processed, 13);
  assert.equal(directory.files.get(existing.codeFileName).text, existingBefore, 'abort preserves previous existing file');
  assert.equal(existing.codeSynced, false);
  assert.equal(failedNew.codeSynced, false);
  assert.equal(directory.counts.aborted, 2);
  assert.equal(directory.files.has('fails-new.css'), false, 'failed new empty file removed');
  assert.ok(!result.manifest.includes('fails-new.css'));
  assert.equal(directory.counts.active, 0);

  directory.failures.clear();
  directory.failures.set('manifest.json', 'close');
  directory.resetCounts();
  const previousManifest = directory.files.get('manifest.json').text;
  result = await syncLibraryToProject(state.animations, callbacks);
  assert.equal(result.written, 2);
  assert.ok(result.manifestError);
  assert.equal(directory.files.get('manifest.json').text, previousManifest, 'manifest abort preserves original catalog');
  assert.equal(failedNew.localPresent, true, 'successful local save retained when catalog publish fails');
  assert.equal(failedNew.repositoryPresent, false);
  assert.match(messages.at(-1), /catalog could not be updated/);
  assert.equal(directory.counts.active, 0);

  directory.failures.clear();
  directory.resetCounts();
  result = await syncLibraryToProject(state.animations, callbacks);
  assert.equal(result.written, 0);
  assert.equal(directory.counts.streams, 1, 'retry publishes catalog without rewriting successful CSS');
  assert.equal(failedNew.repositoryPresent, true);

  directory.resetCounts();
  existing.css = 'opacity: .7;';
  await Promise.all([pushAnimationToCode('a', callbacks), pushAnimationToCode('a', callbacks)]);
  assert.equal(directory.counts.streams, 1, 'overlapping saves serialize, second skips');
  assert.equal(directory.files.get(existing.codeFileName).text, buildExportCSS(existing));
  t.diagnostic(`First publish: ${initial.streams} streams. Repeat: ${repeat.streams} streams, ${repeat.read} reads.`);

});

