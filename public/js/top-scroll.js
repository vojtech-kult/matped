// Přidá nad prvek s vodorovným posunem druhou posuvnou lištu.
// Zobrazí se jen tehdy, když se obsah nevejde na šířku.
function enableTopScroll(wrap) {
  const bar = document.createElement('div');
  bar.className = 'scroll-top';
  bar.hidden = true;
  const inner = document.createElement('div');
  bar.append(inner);
  wrap.before(bar);

  // Obě lišty se drží ve stejné pozici (bez přepisu stejné hodnoty, takže žádná smyčka)
  bar.addEventListener('scroll', () => {
    if (wrap.scrollLeft !== bar.scrollLeft) wrap.scrollLeft = bar.scrollLeft;
  });
  wrap.addEventListener('scroll', () => {
    if (bar.scrollLeft !== wrap.scrollLeft) bar.scrollLeft = wrap.scrollLeft;
  });

  const update = () => {
    inner.style.width = `${wrap.scrollWidth}px`;
    bar.hidden = wrap.scrollWidth <= wrap.clientWidth + 1;
  };
  const observer = new ResizeObserver(update);
  observer.observe(wrap);
  if (wrap.firstElementChild) observer.observe(wrap.firstElementChild);
  update();
}