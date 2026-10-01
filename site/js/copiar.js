for (const boton of document.querySelectorAll("[data-copiar]")) {
  const texto = boton.textContent;
  boton.hidden = false;
  boton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(boton.dataset.copiar);
      boton.textContent = boton.dataset.copiado;
    } catch {
      const comando = boton.parentElement.querySelector("code");
      if (comando) getSelection().selectAllChildren(comando);
      boton.textContent = boton.dataset.fallo;
    }
    setTimeout(() => {
      boton.textContent = texto;
    }, 2000);
  });
}
