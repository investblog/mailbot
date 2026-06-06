// HTML → текст нативным HTMLRewriter (zero-dep, рантайм Workers).
// Вытаскиваем видимый текст + ссылки отдельным блоком. Никакой конвертации в TG-HTML.

const BLOCK = 'p,div,br,tr,li,h1,h2,h3,h4,h5,h6,table,section,article,header,footer,blockquote';
const DROP = 'script,style,head,noscript,template,iframe';

export async function htmlToText(html) {
  if (!html) return { text: '', links: [] };

  let text = '';
  const links = [];
  let skip = 0; // глубина внутри drop-элементов

  const rewriter = new HTMLRewriter()
    .on(DROP, {
      element(el) {
        skip++;
        el.onEndTag(() => { skip--; });
        el.remove();
      },
    })
    .on(BLOCK, {
      element() { text += '\n'; },
    })
    .on('a', {
      element(el) {
        const href = el.getAttribute('href');
        if (href && /^https?:\/\//i.test(href) && !links.includes(href)) links.push(href);
      },
    })
    .onDocument({
      text(t) { if (!skip) text += t.text; },
    });

  // Прогоняем поток, чтобы сработали хендлеры (вывод rewriter нам не нужен).
  await rewriter.transform(new Response(html)).arrayBuffer();

  // Схлопываем пустоту: пробелы/табы и пачки переводов строк.
  text = text.replace(/[ \t ]+/g, ' ')
             .replace(/ *\n */g, '\n')
             .replace(/\n{3,}/g, '\n\n')
             .trim();

  return { text, links: links.slice(0, 10) };
}
