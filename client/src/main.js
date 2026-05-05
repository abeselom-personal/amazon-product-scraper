// Amazon Product Discovery Engine - Frontend
const API = '/api/pipeline';

const state = {
    view: 'search',
    mode: 'keyword',         // 'keyword' | 'category'
    topLimit: 100,
    pageSize: 20,
    page: 1,
    category: '',            // results filter
    products: [],
    runs: [],
    config: null,
    categories: [],
};

// ---------- Utilities ----------
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, type = 'info', ms = 3500) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    return `£${Number(n).toFixed(2)}`;
}
function fmtScore(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(3);
}
function scoreClass(s) {
    if (s == null) return '';
    if (s >= 0.7) return 'score-high';
    if (s >= 0.5) return 'score-mid';
    return 'score-low';
}
function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || `Request failed: ${res.status}`);
    }
    return res.json();
}

// ---------- View routing ----------
function setView(view) {
    state.view = view;
    $all('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $all('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    if (view === 'results') loadTopProducts();
    if (view === 'runs') loadRuns();
}
$all('.nav-btn').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

// ---------- Mode toggle (keyword <-> category) ----------
$all('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode;
        $all('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        $('#field-keyword').classList.toggle('hidden', state.mode !== 'keyword');
        $('#field-category').classList.toggle('hidden', state.mode !== 'category');
        const kw = $('#keyword-input');
        kw.required = state.mode === 'keyword';
    });
});

// ---------- Config bootstrap ----------
async function loadConfig() {
    try {
        const cfg = await api('/config');
        state.config = cfg;
        state.categories = cfg.categories || [];
        // populate category select
        const sel = $('#category-select');
        sel.innerHTML = state.categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('') || '<option value="">No categories configured</option>';
        renderConfigBanner();
    } catch (err) {
        console.warn('[CFG] Failed to load config:', err.message);
    }
}

function renderConfigBanner() {
    const cfg = state.config;
    if (!cfg) return;
    const banner = $('#config-banner');
    const minP = cfg.filters.enableMinimumPrice
        ? `<span>Min price <span class="badge ok">£${cfg.filters.minimumPriceGBP}</span></span>`
        : `<span>Min price <span class="badge warn">off</span></span>`;
    const maxP = cfg.filters.enableMaximumPrice
        ? `<span>Max price <span class="badge ok">£${cfg.filters.maximumPriceGBP}</span></span>`
        : `<span>Max price <span class="badge warn">off</span></span>`;
    const shipW = cfg.filters.maxShippableWeightGrams != null
        ? `<span>Resale-pack ship weight <span class="badge ok">≤${cfg.filters.maxShippableWeightGrams}g</span></span>`
        : '';
    const aiBadge = cfg.ai.provider === 'google'
        ? (cfg.ai.hasApiKey ? `<span class="badge ok">Gemini · ${escapeHtml(cfg.ai.model)}</span>` : `<span class="badge warn">Gemini (no API key — using mock)</span>`)
        : `<span class="badge">${escapeHtml(cfg.ai.provider)}</span>`;
    const cats = cfg.categories?.length
        ? cfg.categories.map(c => `<span class="badge">${escapeHtml(c.name)}</span>`).join('')
        : `<span class="badge warn">none</span>`;
    banner.innerHTML = `
        <span><strong>AI:</strong> ${aiBadge}</span>
        ${minP}
        ${maxP}
        ${shipW}
        <span><strong>Categories:</strong> ${cats}</span>
    `;
    banner.classList.remove('hidden');
}

// ---------- Search & scrape ----------
const form = $('#search-form');
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const region = $('#region-select').value;
    const maxPages = parseInt($('#pages-input').value, 10) || 3;
    const isCat = state.mode === 'category';
    const keyword = $('#keyword-input').value.trim();
    const category = $('#category-select').value;

    if (isCat && !category) return toast('Pick a category', 'error');
    if (!isCat && !keyword) return toast('Enter a keyword', 'error');

    const btn = $('#scrape-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Running…';
    $('#pipeline-progress').classList.remove('hidden');
    $('#scrape-summary').classList.add('hidden');
    $('#scrape-results').innerHTML = '';
    setProgress(isCat ? `Scraping category "${category}"…` : 'Launching browser…', 15);

    try {
        setTimeout(() => setProgress('Scraping product listings across pages…', 35), 1500);
        setTimeout(() => setProgress('Filtering by price & deduplicating…', 55), 4000);
        setTimeout(() => setProgress('Validating with Google AI Studio (image + metadata)…', 80), 8000);

        const endpoint = isCat ? '/scrape/category' : '/scrape';
        const payload = isCat ? { category, region, maxPages } : { keyword, region, maxPages };
        const data = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });

        setProgress('Complete!', 100);
        renderSummary(data);

        const topAfterRun = await api(`/products/top?limit=100`).catch(() => ({ products: [] }));
        const filtered = (topAfterRun.products || []).filter(p => p.source_run_id === data.runId);
        const toShow = filtered.length ? filtered : (topAfterRun.products || []).slice(0, 20);
        renderProducts($('#scrape-results'), toShow);

        const s = data.stats || {};
        const f = state.config?.filters;
        const range = f
            ? `${f.enableMinimumPrice ? '≥£' + f.minimumPriceGBP : ''}${f.enableMinimumPrice && f.enableMaximumPrice ? ' & ' : ''}${f.enableMaximumPrice ? '≤£' + f.maximumPriceGBP : ''}`
            : '';
        toast(`✓ Pipeline complete: ${s.new || 0} new, ${s.updated || 0} updated, ${s.deduplicated || 0} dup, ${s.filtered || 0} filtered${range ? ' (' + range + ')' : ''}`, 'success', 5500);
        updateGlobalStats();
    } catch (err) {
        toast('✗ ' + err.message, 'error', 6000);
        setProgress('Failed: ' + err.message, 0);
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Run Pipeline';
        setTimeout(() => $('#pipeline-progress').classList.add('hidden'), 2500);
    }
});

function setProgress(text, pct) {
    $('#progress-text').textContent = text;
    $('.progress-fill').style.width = `${pct}%`;
}

function renderSummary(data) {
    const s = data.stats || {};
    const rs = data.runStats || {};
    const el = $('#scrape-summary');
    el.classList.remove('hidden');
    el.innerHTML = `
        <div class="stat accent"><div class="label">Scraped</div><div class="value">${s.scraped || 0}</div></div>
        <div class="stat green"><div class="label">New</div><div class="value">${s.new || 0}</div></div>
        <div class="stat"><div class="label">Updated</div><div class="value">${s.updated || 0}</div></div>
        <div class="stat"><div class="label">Deduped</div><div class="value">${s.deduplicated || 0}</div></div>
        <div class="stat"><div class="label">Filtered (price)</div><div class="value">${s.filtered || 0}</div></div>
        <div class="stat"><div class="label">Avg Score</div><div class="value">${rs.avg_score != null ? Number(rs.avg_score).toFixed(3) : '—'}</div></div>
        <div class="stat"><div class="label">Bulk Items</div><div class="value">${rs.bulk_products || 0}</div></div>
    `;
}

// ---------- Results view ----------
$('#top-limit').addEventListener('change', e => { state.topLimit = +e.target.value; state.page = 1; loadTopProducts(); });
$('#page-size').addEventListener('change', e => { state.pageSize = +e.target.value; state.page = 1; renderResultsPage(); });
$('#category-filter').addEventListener('change', e => { state.category = e.target.value; state.page = 1; renderResultsPage(); });
$('#refresh-top').addEventListener('click', loadTopProducts);
$('#export-btn').addEventListener('click', doExport);

async function loadTopProducts() {
    const list = $('#results-list');
    list.innerHTML = `<div class="empty-state"><h3>Loading…</h3><p>Fetching top ${state.topLimit} products.</p></div>`;
    try {
        const data = await api(`/products/top?limit=${state.topLimit}`);
        state.products = data.products || [];
        if (!state.products.length) {
            list.innerHTML = `<div class="empty-state"><h3>No products yet</h3><p>Run a scrape to populate the database.</p></div>`;
            $('#pager').classList.add('hidden');
            return;
        }
        state.page = 1;
        renderResultsPage();
        updateGlobalStats();
    } catch (err) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
    }
}

function renderResultsPage() {
    const list = $('#results-list');
    let items = state.products;
    if (state.category) items = items.filter(p => p.category === state.category);
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.pageSize;
    const slice = items.slice(start, start + state.pageSize);

    if (!slice.length) {
        list.innerHTML = `<div class="empty-state"><h3>No matches</h3><p>No products match this filter.</p></div>`;
        $('#pager').classList.add('hidden');
        return;
    }

    renderProducts(list, slice, start);
    renderPager(total, pages);
}

function renderProducts(container, products, rankOffset = 0) {
    container.innerHTML = products.map((p, i) => productCard(p, i + rankOffset + 1)).join('');
    // attach carousel handlers
    container.querySelectorAll('.carousel').forEach(setupCarousel);
}

function getImages(p) {
    if (Array.isArray(p.images) && p.images.length) return p.images;
    if (p.image_url) return [p.image_url];
    return [];
}

function productCard(p, rank) {
    const score = p.final_score;
    const cls = scoreClass(score);
    const bulkTag = p.is_bulk ? `<span class="tag bulk">📦 Bulk · ${p.quantity_estimate || 1}x</span>` : '';
    const primeTag = p.prime_eligible ? `<span class="tag prime">Prime</span>` : '';
    const catTag = p.category ? `<span class="tag cat">${escapeHtml(p.category)}</span>` : '';
    const resellTag = p.ai_is_resellable === 1
        ? `<span class="tag resellable">✓ Resellable</span>`
        : (p.ai_is_resellable === 0 ? `<span class="tag not-resellable">✗ Not resellable</span>` : '');
    const resalePackShippable = p.ai_is_resale_pack_shippable_under_100g ?? p.ai_is_shippable_under_100g;
    const shipTag = resalePackShippable === 1
        ? `<span class="tag shippable">📮 Resale pack ≤100g</span>`
        : (resalePackShippable === 0 ? `<span class="tag not-shippable">⚠ Resale pack >100g</span>` : '');
    const resaleQty = p.ai_recommended_resale_pack_quantity;
    const resalePackWeight = p.ai_estimated_resale_pack_weight_grams ?? p.ai_estimated_weight_grams;

    const images = getImages(p);
    const carousel = images.length
        ? `<div class="carousel" data-index="0">
              <div class="carousel-track">
                ${images.map(src => `<div class="carousel-slide"><img src="${escapeHtml(src)}" alt="" loading="lazy"/></div>`).join('')}
              </div>
              ${images.length > 1 ? `
                <button class="carousel-arrow prev" aria-label="Previous image">‹</button>
                <button class="carousel-arrow next" aria-label="Next image">›</button>
                <div class="carousel-dots">
                    ${images.map((_, i) => `<button class="carousel-dot ${i === 0 ? 'active' : ''}" data-i="${i}"></button>`).join('')}
                </div>
              ` : ''}
           </div>`
        : `<div class="product-img placeholder">📦</div>`;

    const asin = p.asin ? ` · ${p.asin}` : '';
    const unit = p.unit_price ? ` · unit ${fmtMoney(p.unit_price)}` : '';

    const signals = Array.isArray(p.ai_signals) ? p.ai_signals : [];
    const aiBlock = (p.ai_summary || signals.length)
        ? `<div class="ai-block">
              ${p.ai_summary ? `<div class="ai-summary">🤖 ${escapeHtml(p.ai_summary)}</div>` : ''}
              ${signals.length ? `<div class="ai-signals">${signals.slice(0, 6).map(s => `<span class="signal">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
           </div>`
        : '';

    return `
        <article class="product-card">
            <span class="product-rank">#${rank}</span>
            ${score != null ? `<span class="product-score ${cls}">${fmtScore(score)}</span>` : ''}
            ${carousel}
            <div class="product-body">
                <h3 class="product-title"><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></h3>
                <div class="product-price-row">
                    <div class="product-price">${fmtMoney(p.price)}</div>
                    <div class="product-unit-price">${unit || ''}${asin}</div>
                </div>
                <div class="product-meta">
                    ${catTag}
                    ${bulkTag}
                    ${resellTag}
                    ${shipTag}
                    ${primeTag}
                </div>
                ${aiBlock}
                <div class="product-stats">
                    <span class="rating">${p.rating ? '⭐ ' + p.rating : '—'}</span>
                    <span>${p.review_count || 0} reviews</span>
                    <span>${resaleQty != null ? 'Resale qty: ' + resaleQty : ''}</span>
                    <span>${resalePackWeight != null ? Math.round(resalePackWeight) + 'g resale-pack est.' : ''}</span>
                    <span>${p.resale_suitability ? p.resale_suitability.toUpperCase() : ''}</span>
                </div>
                <div class="product-scores">
                    <div class="score-cell"><strong>${fmtScore(p.bulk_score)}</strong>Bulk</div>
                    <div class="score-cell"><strong>${fmtScore(p.demand_score)}</strong>Demand</div>
                    <div class="score-cell"><strong>${fmtScore(p.trust_score)}</strong>Trust</div>
                    <div class="score-cell"><strong>${fmtScore(p.unit_margin_score)}</strong>Margin</div>
                    <div class="score-cell"><strong>${fmtScore(p.shipping_score)}</strong>Shipping</div>
                </div>
            </div>
        </article>
    `;
}

function setupCarousel(el) {
    const track = el.querySelector('.carousel-track');
    const slides = el.querySelectorAll('.carousel-slide');
    const dots = el.querySelectorAll('.carousel-dot');
    const prev = el.querySelector('.carousel-arrow.prev');
    const next = el.querySelector('.carousel-arrow.next');
    if (slides.length <= 1) return;

    let idx = 0;
    const goTo = (i) => {
        idx = (i + slides.length) % slides.length;
        track.style.transform = `translateX(-${idx * 100}%)`;
        dots.forEach((d, di) => d.classList.toggle('active', di === idx));
        el.dataset.index = idx;
    };
    prev?.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); goTo(idx - 1); });
    next?.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); goTo(idx + 1); });
    dots.forEach(d => d.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); goTo(parseInt(d.dataset.i, 10)); }));
}

function renderPager(total, pages) {
    const pager = $('#pager');
    if (pages <= 1) { pager.classList.add('hidden'); return; }
    pager.classList.remove('hidden');

    const btns = [];
    btns.push(`<button ${state.page === 1 ? 'disabled' : ''} data-p="prev">← Prev</button>`);

    const start = Math.max(1, state.page - 2);
    const end = Math.min(pages, start + 4);
    if (start > 1) btns.push(`<button data-p="1">1</button>${start > 2 ? '<span class="pager-info">…</span>' : ''}`);
    for (let i = start; i <= end; i++) {
        btns.push(`<button class="${i === state.page ? 'active' : ''}" data-p="${i}">${i}</button>`);
    }
    if (end < pages) btns.push(`${end < pages - 1 ? '<span class="pager-info">…</span>' : ''}<button data-p="${pages}">${pages}</button>`);

    btns.push(`<span class="pager-info">${total} items</span>`);
    btns.push(`<button ${state.page === pages ? 'disabled' : ''} data-p="next">Next →</button>`);
    pager.innerHTML = btns.join('');

    pager.querySelectorAll('button[data-p]').forEach(b => {
        b.addEventListener('click', () => {
            const v = b.dataset.p;
            if (v === 'prev') state.page = Math.max(1, state.page - 1);
            else if (v === 'next') state.page = Math.min(pages, state.page + 1);
            else state.page = parseInt(v, 10);
            renderResultsPage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

async function doExport() {
    const btn = $('#export-btn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Exporting…';
    try {
        const url = `${API}/export/top?limit=${encodeURIComponent(state.topLimit)}`;
        const link = document.createElement('a');
        link.href = url;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast('✓ Export started. Your file should download shortly.', 'success', 5000);
    } catch (err) {
        toast('✗ Export failed: ' + err.message, 'error', 5000);
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

// ---------- Runs view ----------
$('#refresh-runs').addEventListener('click', loadRuns);

async function loadRuns() {
    const list = $('#runs-list');
    list.innerHTML = `<div class="empty-state"><h3>Loading…</h3></div>`;
    try {
        const data = await api('/runs?limit=25');
        state.runs = data.runs || [];
        if (!state.runs.length) {
            list.innerHTML = `<div class="empty-state"><h3>No runs yet</h3><p>Run your first scrape from the Search tab.</p></div>`;
            return;
        }
        list.innerHTML = state.runs.map(runCard).join('');
    } catch (err) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
    }
}

function runCard(r) {
    const started = new Date(r.started_at + 'Z').toLocaleString();
    const label = r.run_type === 'category' && r.category ? `📂 ${r.category}` : `🔍 ${r.keyword}`;
    return `
        <div class="run-card">
            <div>
                <div class="keyword">${escapeHtml(label)}</div>
                <span class="subtle">${r.region} · ${started} · ${r.id.slice(0,8)}</span>
            </div>
            <div class="metric"><strong>${r.products_scraped || 0}</strong>Scraped</div>
            <div class="metric"><strong>${r.products_new || 0}</strong>New</div>
            <div class="metric"><strong>${r.products_updated || 0}</strong>Updated</div>
            <div class="metric"><strong>${r.products_filtered || 0}</strong>Filtered</div>
            <span class="status-pill status-${r.status}">${r.status}</span>
        </div>
    `;
}

// ---------- Global stats ----------
async function updateGlobalStats() {
    try {
        const data = await api('/products/top?limit=500');
        const products = data.products || [];
        $('#stat-total').textContent = products.length;
        $('#stat-bulk').textContent = products.filter(p => p.is_bulk).length;
        const avg = products.length ? (products.reduce((s, p) => s + (p.final_score || 0), 0) / products.length) : 0;
        $('#stat-avg').textContent = avg ? avg.toFixed(3) : '—';
    } catch (e) { /* silent */ }
}

// ---------- Init ----------
loadConfig();
updateGlobalStats();
