# Motion Shelf

**Motion Shelf** is a visual CSS animation library for collecting, previewing, editing, and reusing CSS animations.

Its interface keeps the original eight-point teal/blue background and adds two slow morphing color layers plus a randomized field of tiny ambient sparks. The effect is decorative, click-through, and respects reduced-motion preferences.

> **Copy animation. Paste anywhere.**

Motion Shelf is designed to work locally as a simple HTML/CSS/JavaScript project. You can add your own animations, preview them, edit their CSS and keyframes, and keep your personal animation library in one place.

---

## ✨ Features

* Visual animation library
* Search animations
* Filter by category
* Filter by device
* Filter by interaction
* Live animation previews
* Animation detail modal
* CSS and keyframe editor
* Custom categories
* Image previews
* Desktop / Mobile / Both device support
* Hover / Appear / Disappear / Infinite / Static interactions
* Copy animation CSS and keyframes
* Local animation storage
* Delete animations locally
* Optional project-code deletion
* Responsive interface
* Works locally without a backend

---

# 🚀 Live Demo

**Live site:**

https://gxella.github.io/motion-shelf/

> If the link above has not been enabled yet, follow the **GitHub Pages** instructions below.

---

# 📦 Getting Motion Shelf

There are two ways to get the project.

## Option 1 — Download ZIP

Open the GitHub repository:

https://github.com/GXeLla/motion-shelf

Click:

**Code → Download ZIP**

Extract the ZIP file somewhere on your computer.

Then open the extracted `motion-shelf` folder.

---

## Option 2 — Clone with Git

If Git is installed on your computer, run:

```bash
git clone https://github.com/GXeLla/motion-shelf.git
```

Then enter the project:

```bash
cd motion-shelf
```

---

# 💻 Running Motion Shelf Locally

Motion Shelf is intended to be used locally during development.

You can use VS Code with the **Live Server** extension.

### Using VS Code + Live Server

1. Download or clone the repository.
2. Open the `motion-shelf` folder in VS Code.
3. Install the **Live Server** extension if you don't already have it.
4. Open `index.html`.
5. Right-click `index.html`.
6. Choose:

**Open with Live Server**

---

# 🛠️ Using Motion Shelf

Once Motion Shelf is running locally:

1. Click **New**.
2. Enter the animation name.
3. Choose the target element.
4. Add a description.
5. Select the device:

   * Desktop
   * Mobile
   * Both
6. Select the interaction.
7. Choose or create categories.
8. Optionally add an image URL.
9. Enter the animation keyframe name.
10. Add your CSS properties.
11. Add your keyframes.
12. Add parent properties if your animation requires them.
13. Save the animation.

Your animation will then appear in the library.

---

# 🎨 Creating Your Own Animation

A typical animation contains three important parts:

### CSS properties

Example:

```css
animation: floating-image 3s ease-in-out infinite;
```

### Keyframes

Example:

```css
@keyframes floating-image {
  0% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-12px);
  }

  100% {
    transform: translateY(0);
  }
}
```

### Parent properties

Some animations require properties on a parent element.

For example:

```css
perspective: 1000px;
transform-style: preserve-3d;
```

Use the **Parent properties** field when your animation needs them.

---

# 📁 Project Structure

The project is intentionally simple:

```text
motion-shelf/
│
├── index.html
│
├── styles/
│   ├── styles.css
│   ├── base.css
│   ├── header.css
│   ├── filters.css
│   ├── cards.css
│   ├── modals.css
│   ├── forms.css
│   ├── toast.css
│   └── keyframes.css
│
├── scripts/
│   ├── app.js
│   └── ...
│
└── README.md
```

### `index.html`

Contains the application structure and modals.

### `styles/`

Contains the application's CSS.

### `scripts/`

Contains the JavaScript that powers the application.

### `keyframes.css`

Contains the reusable CSS animation keyframes.

---

# 🧩 Using Motion Shelf for Your Own Project

If you want to use Motion Shelf as your own animation workspace, the recommended workflow is:

```text
Download / Clone Motion Shelf
            ↓
Open it locally
            ↓
Add your animations
            ↓
Customize the project
            ↓
Test locally
            ↓
Create your own GitHub repository
            ↓
Push your customized version
            ↓
Publish your own version
```

You should create **your own repository** for your customized version rather than pushing changes to the original repository.

---

# 🐙 Creating Your Own GitHub Repository

After downloading or cloning Motion Shelf, create a new repository on your GitHub account.

For example:

```text
my-motion-shelf
```

or:

```text
my-animation-library
```

When creating the repository, you can leave it empty.

Do not initialize another README if you already have one locally.

---

# 📤 Uploading Your Customized Motion Shelf

After creating your GitHub repository, open the Motion Shelf project locally.

If you are using Git for the first time, initialize the project:

```bash
git init
```

Add all project files:

```bash
git add .
```

Create your first commit:

```bash
git commit -m "Initial Motion Shelf project"
```

Make sure the main branch is called `main`:

```bash
git branch -M main
```

Connect your local project to **your own repository**:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
```

For example:

```bash
git remote add origin https://github.com/GXeLla/my-motion-shelf.git
```

Finally, push the project:

```bash
git push -u origin main
```

After that, your customized Motion Shelf project will be available in your GitHub repository.

---

# 🔄 Updating Your Repository

After making changes locally:

```bash
git add .
```

Create a commit:

```bash
git commit -m "Update animations"
```

Push the changes:

```bash
git push
```

Your GitHub repository will then contain the latest version.

---

# 🖥️ Using GitHub Desktop

You can also use **GitHub Desktop** instead of the command line.

### First setup

1. Install GitHub Desktop.
2. Sign in to GitHub.
3. Add your local Motion Shelf folder.
4. Review the changes.
5. Enter a commit message.
6. Click **Commit to main**.
7. Click **Publish repository** if the repository does not exist yet.

### After the repository exists

Your normal workflow becomes:

```text
Edit project
    ↓
Open GitHub Desktop
    ↓
Review changes
    ↓
Write commit message
    ↓
Commit to main
    ↓
Push origin
```

---

# 🌐 Publishing Your Own Version with GitHub Pages

You can publish your customized Motion Shelf project as a live website using GitHub Pages.

After pushing your project to GitHub:

1. Open your repository on GitHub.
2. Go to **Settings**.
3. Open **Pages**.
4. Under **Build and deployment**, choose:

   * **Source:** Deploy from a branch
   * **Branch:** `main`
   * Folder: `/ (root)`
5. Click **Save**.

GitHub will build and publish the website.

Your URL will normally look like:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/
```

For example:

```text
https://GXeLla.github.io/motion-shelf/
```

It may take a short time for the website to become available.

---

# ⚠️ Important: GitHub Pages and Local Editing

GitHub Pages only publishes the files that are committed and pushed to your repository.

If you change files locally:

```text
Local changes
     ↓
git add .
     ↓
git commit
     ↓
git push
     ↓
GitHub Pages updates
```

So if your live website doesn't show your latest changes, make sure you committed and pushed them.

---

# 🔁 Updating the Live Website

For future changes:

```bash
git add .
git commit -m "Update Motion Shelf"
git push
```

GitHub Pages will automatically deploy the new version.

---

# 🧹 Before Publishing

Before pushing your project to GitHub, make sure you don't accidentally include private files.

Do **not** commit:

```text
.env
.env.*
node_modules/
.DS_Store
.vscode/
```

A basic `.gitignore` can contain:

```gitignore
.DS_Store
.env
.env.*
node_modules/
.vscode/
```

Never commit passwords, API keys, access tokens, or other private credentials.

---

# 🧪 Recommended Development Workflow

For development, use:

```text
VS Code
   +
Live Server
   +
GitHub Desktop
   +
GitHub Pages
```

A typical workflow:

```text
1. Open project in VS Code
          ↓
2. Start Live Server
          ↓
3. Make changes
          ↓
4. Test locally
          ↓
5. Open GitHub Desktop
          ↓
6. Review changes
          ↓
7. Commit to main
          ↓
8. Push origin
          ↓
9. GitHub Pages deploys
          ↓
10. Check the live website
```

---

# 🤝 Contributing

If you want to improve Motion Shelf, you can:

1. Fork the repository.
2. Clone your fork.
3. Create a branch for your changes.
4. Make and test your changes locally.
5. Commit your changes.
6. Push your branch.
7. Open a Pull Request.

---

# 📄 License

Add your chosen license here.

If no license has been selected yet, please check the repository before reusing or redistributing the project.

---

# 💡 Philosophy

Motion Shelf is built around a simple idea:

> Build once. Save it. Find it later. Copy it anywhere.

Instead of searching through old projects for animations, Motion Shelf gives you a visual place to store and reuse them.
