// 轻量渲染逻辑：支持 1) 本地示例数据 2) ChatGPT 注入的 structuredContent

type Product = {
  id: string;
  title: string;
  price: number;
  currency: string;
  image?: string;
  brand?: string;
  rating?: number; // 0~5
  url?: string;
};

type HydratePayload = {
  query?: string;
  items: Product[];
};

const $q = document.getElementById('q')!;
const $grid = document.getElementById('grid')!;
const $empty = document.getElementById('empty')! as HTMLDivElement;

function fmtPrice(p: Product) {
  const f = new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency || 'USD' });
  return f.format(p.price);
}

function star(n?: number) {
  if (!n && n !== 0) return '';
  const full = '★'.repeat(Math.max(0, Math.floor(n)));
  const empty = '☆'.repeat(5 - Math.floor(n || 0));
  return `${full}${empty}`;
}

function render(payload: HydratePayload) {
  $q.textContent = payload.query ? `搜索：${payload.query}` : '热门推荐';
  $grid.innerHTML = '';

  if (!payload.items?.length) {
    $empty.style.display = 'block';
    return;
  }
  $empty.style.display = 'none';

  for (const p of payload.items) {
    const card = document.createElement('div');
    card.className = 'card';

    const img = document.createElement('img');
    img.className = 'thumb';
    img.alt = p.title;
    img.loading = 'lazy';
    img.src = p.image || 'https://picsum.photos/seed/' + encodeURIComponent(p.id) + '/640/480';

    const body = document.createElement('div');
    body.className = 'body';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = p.title;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = [p.brand, star(p.rating)].filter(Boolean).join(' · ');

    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = fmtPrice(p);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const a = document.createElement('a');
    a.className = 'link';
    a.href = p.url || '#';
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.textContent = '查看';

    actions.append(a);

    body.append(title, meta, price);
    card.append(img, body, actions);
    $grid.append(card);
  }
}

// 1) 本地开发：没有外部注入时，使用示例数据
const sample: HydratePayload = {
  query: 'wireless earbuds',
  items: [
    { id: '1', title: 'AirDots Pro', price: 59.99, currency: 'USD', brand: 'Acme', rating: 4.4 },
    { id: '2', title: 'NoiseCancel X', price: 129.0, currency: 'USD', brand: 'Acme', rating: 4.8 },
    { id: '3', title: 'SportBeat Mini', price: 39.0, currency: 'USD', brand: 'Yuki', rating: 4.1 },
    { id: '4', title: 'CrystalSound S', price: 79.0, currency: 'USD', brand: 'Zeta', rating: 4.3 },
    { id: '5', title: 'BassGo Plus', price: 49.9, currency: 'USD', brand: 'Zeta', rating: 3.9 },
  ],
};

render(sample);