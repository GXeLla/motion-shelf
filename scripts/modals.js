import { state } from "./state.js";

export function createModalController() {
  const detailBackdrop = document.getElementById("detailModalBackdrop");

  const editorBackdrop = document.getElementById("editorModalBackdrop");

  const deleteBackdrop = document.getElementById("deleteModalBackdrop");

  const detailClose = document.getElementById("detailCloseButton");

  const editorClose = document.getElementById("editorCloseButton");

  const editorCancel = document.getElementById("editorCancelButton");

  const deleteClose = document.getElementById("deleteCloseButton");

  function closeAll() {
    detailBackdrop.hidden = true;
    editorBackdrop.hidden = true;
    deleteBackdrop.hidden = true;

    document.body.style.overflow = "";

    state.detailId = null;
  }

  function openDetail() {
    closeAll();

    detailBackdrop.hidden = false;

    document.body.style.overflow = "hidden";
  }

  function openEditor() {
    closeAll();

    editorBackdrop.hidden = false;

    document.body.style.overflow = "hidden";
  }

  function openDelete() {
    closeAll();

    deleteBackdrop.hidden = false;

    document.body.style.overflow = "hidden";
  }

  detailClose.addEventListener("click", closeAll);

  editorClose.addEventListener("click", closeAll);

  editorCancel.addEventListener("click", closeAll);

  deleteClose.addEventListener("click", closeAll);

  /*
   * Details and delete may close
   * when clicking their backdrop.
   *
   * Editor deliberately does NOT.
   */

  detailBackdrop.addEventListener("click", (event) => {
    if (event.target === detailBackdrop) {
      closeAll();
    }
  });

  deleteBackdrop.addEventListener("click", (event) => {
    if (event.target === deleteBackdrop) {
      closeAll();
    }
  });

  /*
   * ESC closes details/delete.
   * ESC does not close editor.
   */

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (!editorBackdrop.hidden) {
      return;
    }

    closeAll();
  });

  return {
    closeAll,
    openDetail,
    openEditor,
    openDelete,
  };
}
