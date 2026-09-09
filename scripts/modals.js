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

    // The editor can retain its previous scroll position. Always show its
    // heading first when reopening it (especially when editing an animation).
    editorBackdrop.scrollTop = 0;
    editorBackdrop.querySelector(".modal").scrollTop = 0;

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

  detailBackdrop.addEventListener("click", (event) => {
    if (event.target === detailBackdrop) {
      closeAll();
    }
  });

  editorBackdrop.addEventListener("click", (event) => {
    if (event.target === editorBackdrop) {
      closeAll();
    }
  });

  deleteBackdrop.addEventListener("click", (event) => {
    if (event.target === deleteBackdrop) {
      closeAll();
    }
  });

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
