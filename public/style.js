  /* ===== STATE ===== */
  let allScholarships = [];
  let filteredData    = [];
  let currentSchol    = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function getApplicationUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  /* ===== API ===== */
  async function fetchAll() {
    const res = await fetch('/api/scholarships');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    const body = await res.json();
    return body.data;
  }

  /* ===== PAGE NAVIGATION ===== */
  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + id).classList.add('active');
    window.scrollTo(0,0);
    // active nav
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    if (id === 'landing') document.getElementById('nav-home')?.classList.add('active');
    if (id === 'search') document.getElementById('nav-search')?.classList.add('active');
  }

  function goToSearch() {
    showPage('search');
    if (allScholarships.length === 0) {
      loadSearchData();
    } else {
      filteredData = [...allScholarships];
      renderCards(allScholarships);
    }
  }

  function filterByCategory(cat) {
    goToSearch();
    setTimeout(() => {
      // Special case: Engineering category click from landing
      if (cat.toLowerCase() === 'engineering') {
        document.getElementById('f-course').value = 'engineering';
        document.getElementById('f-category').value = '';
        applyFilters();
        return;
      }
      const sel = document.getElementById('f-category');
      let found = false;
      for (let opt of sel.options) {
        if (cat.toLowerCase().includes(opt.value.toLowerCase()) ||
            opt.value.toLowerCase().includes(cat.toLowerCase())) {
          sel.value = opt.value;
          found = true;
          break;
        }
      }
      if (!found) sel.value = '';
      applyFilters();
    }, 120);
  }

  function heroSearch() {
    const q = document.getElementById('hero-search-input').value.trim();
    goToSearch();
    setTimeout(() => {
      document.getElementById('search-input').value = q;
      applyFilters();
    }, 100);
  }

  /* ===== LOAD DATA ===== */
  async function loadSearchData() {
    document.getElementById('cards-container').innerHTML =
      '<div class="loader"><div class="spinner"></div><p>Fetching scholarships from database…</p></div>';
    try {
      allScholarships = await fetchAll();
      filteredData = [...allScholarships];
      renderCards(allScholarships);
      updateLandingStats(allScholarships);
    } catch(e) {
      document.getElementById('cards-container').innerHTML =
        `<div class="empty-state"><div class="empty-icon">❌</div><h3>Could not load data</h3><p>${e.message}</p></div>`;
    }
  }

  async function loadLandingStats() {
    try {
      const data = await fetchAll();
      allScholarships = data;
      updateLandingStats(data);
    } catch(e) { /* silent */ }
  }

  function updateLandingStats(data) {
    document.getElementById('total-count').innerHTML = `<span>${data.length}</span>`;
    // top reward
    const withAmount = data.filter(s => s.reward_amount_text);
    if (withAmount.length) {
      const sorted = withAmount.sort((a,b) => {
        const aNum = parseFloat((a.reward_amount_text||'').replace(/[^0-9.]/g,'')) || 0;
        const bNum = parseFloat((b.reward_amount_text||'').replace(/[^0-9.]/g,'')) || 0;
        return bNum - aNum;
      });
      document.getElementById('top-reward').textContent = sorted[0].reward_amount_text || '—';
    } else {
      document.getElementById('top-reward').textContent = 'Various';
    }
  }

  /* ===== FILTERS & RENDERING ===== */
  function applyFilters() {
    const q      = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
    const cat    = (document.getElementById('f-category')?.value || '').toLowerCase();
    const course = (document.getElementById('f-course')?.value || '');
    const ddl    = (document.getElementById('f-deadline')?.value || '').toLowerCase();
    const income = parseFloat(document.getElementById('f-income')?.value) || Infinity;
    const myPct  = parseFloat(document.getElementById('f-percent')?.value) || 0;
    const sort   = document.getElementById('sort-select')?.value || 'name';

    // If user selected a "coming soon" course — show friendly message
    if (course.startsWith('__nodata__')) {
      const courseName = course.replace('__nodata__', '');
      const label = document.querySelector(`#f-course option[value="${course}"]`)?.text || courseName;
      document.getElementById('result-count').textContent = '0';
      document.getElementById('cards-container').innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">🚧</div>
          <h3>Coming Soon — ${label}</h3>
          <p style="max-width:420px;margin:0 auto 20px;">We're currently focused on <strong>Engineering scholarships</strong>. Scholarships for <strong>${label}</strong> will be added very soon. Stay tuned!</p>
          <button onclick="document.getElementById('f-course').value='';applyFilters()" style="background:linear-gradient(135deg,var(--orange),var(--orange-light));color:white;border:none;padding:12px 28px;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;cursor:pointer;">
            <i class="fas fa-search"></i> Show All Engineering Scholarships
          </button>
        </div>`;
      return;
    }

    // Engineering keywords — matches semicolon-separated field like "B.Tech; BE; B.Tech Computer Science"
    const ENGG_KEYWORDS = ['b.tech','btech','be','b.e','engineering','bachelor of technology','bachelor of engineering'];

    let data = allScholarships.filter(s => {
      // Smart search — matches name, categories, courses, provider
      if (q) {
        const haystack = [
          s.scholarship_name, s.provider_name, s.eligible_categories,
          s.eligible_courses, s.reward_amount_text, s.scholarship_type
        ].map(v => (v || '').toLowerCase()).join(' ');
        // Support multi-word: every word must match somewhere
        const words = q.split(/\s+/).filter(Boolean);
        if (!words.every(w => haystack.includes(w))) return false;
      }

      // Category filter — semicolon or comma separated
      if (cat) {
        const catField = (s.eligible_categories || '').toLowerCase();
        // "All" in the field means everyone is eligible
        if (!catField.includes('all') && !catField.includes(cat)) return false;
      }

      // Course filter — engineering only option
      if (course === 'engineering') {
        const courseField = (s.eligible_courses || '').toLowerCase();
        const matchesEngg = ENGG_KEYWORDS.some(k => courseField.includes(k));
        if (!matchesEngg) return false;
      }

      // Deadline month
      if (ddl && !(s.deadline_month || '').toLowerCase().includes(ddl)) return false;

      // Income filter — show scholarships where max_family_income >= user's income (user is eligible)
      if (income < Infinity && s.max_family_income_inr) {
        if (parseFloat(s.max_family_income_inr) < income) return false;
      }

      // Academics filter — show scholarships where min% <= my%
      if (myPct > 0 && s.min_academic_percentage) {
        if (parseFloat(s.min_academic_percentage) > myPct) return false;
      }

      return true;
    });

    // Sort
    if (sort === 'name') data.sort((a,b) => (a.scholarship_name||'').localeCompare(b.scholarship_name||''));
    else if (sort === 'amount') data.sort((a,b) => {
      const aNum = parseFloat((a.reward_amount_text||'').replace(/[^0-9.]/g,'')) || 0;
      const bNum = parseFloat((b.reward_amount_text||'').replace(/[^0-9.]/g,'')) || 0;
      return bNum - aNum;
    });
    else if (sort === 'deadline') {
      const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      data.sort((a,b) => {
        const ai = months.indexOf((a.deadline_month||'').toLowerCase());
        const bi = months.indexOf((b.deadline_month||'').toLowerCase());
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
    }

    filteredData = data;
    renderCards(data);
  }

  function clearFilters() {
    document.getElementById('search-input').value = '';
    document.getElementById('f-category').value = '';
    document.getElementById('f-course').value = '';
    document.getElementById('f-deadline').value = '';
    document.getElementById('f-income').value = '';
    document.getElementById('f-percent').value = '';
    filteredData = [...allScholarships];
    renderCards(allScholarships);
  }

  function getTypeBadge(s) {
    const cats = (s.eligible_categories || '').toLowerCase();
    const name = (s.scholarship_name || '').toLowerCase();
    if (name.includes('central') || name.includes('national') || name.includes('nsp') || name.includes('pfms'))
      return { cls: 'badge-national', label: '🏛️ National' };
    if (cats.includes('minority'))
      return { cls: 'badge-state', label: '🌙 Minority' };
    if (name.includes('state') || name.includes('pradesh') || name.includes('mukhyamantri'))
      return { cls: 'badge-state', label: '🗺️ State' };
    return { cls: 'badge-default', label: '🏢 Scholarship' };
  }

  function renderCards(data) {
    const container = document.getElementById('cards-container');
    document.getElementById('result-count').textContent = data.length;

    if (data.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>No Scholarships Found</h3>
          <p>Try adjusting your filters or search terms to find more results.</p>
        </div>`;
      return;
    }

    container.innerHTML = data.map((s, i) => {
      const badge = getTypeBadge(s);
      const cats  = s.eligible_categories ? escapeHtml(s.eligible_categories.split(/[,;]/).slice(0,2).map(c=>c.trim()).join(', ')) : '—';
      const crs   = s.eligible_courses ? escapeHtml(s.eligible_courses.split(/[,;]/).slice(0,2).map(c=>c.trim()).join(', ')) : '—';
      return `
      <div class="schol-card" onclick="showDetail(${i})" style="animation-delay:${Math.min(i*0.04,0.5)}s">
        <div class="card-type-badge ${badge.cls}">${badge.label}</div>
        <div class="card-name">${escapeHtml(s.scholarship_name || 'Unnamed Scholarship')}</div>
        <div class="card-amount">
          <div class="amount-pill">${escapeHtml(s.reward_amount_text || 'Amount varies')}</div>
        </div>
        <div class="card-meta">
          <div class="meta-chip"><i class="fas fa-users"></i> ${cats}</div>
          <div class="meta-chip"><i class="fas fa-book"></i> ${crs}</div>
          ${s.min_academic_percentage ? `<div class="meta-chip"><i class="fas fa-percent"></i> ${escapeHtml(s.min_academic_percentage)}%+</div>` : ''}
        </div>
        <div class="card-footer">
          <div class="card-deadline">
            <i class="fas fa-calendar"></i>
            Deadline: ${escapeHtml(s.deadline_month || 'Check portal')}
          </div>
          <button class="view-btn">View Details <i class="fas fa-arrow-right"></i></button>
        </div>
      </div>`;
    }).join('');
  }

  /* ===== DETAIL PAGE ===== */
  function showDetail(idx) {
    const s = filteredData[idx];
    if (!s) return;
    currentSchol = s;
    const badge = getTypeBadge(s);
    const applicationUrl = getApplicationUrl(s.application_link);
    const scholarshipName = escapeHtml(s.scholarship_name || 'Scholarship Details');
    const rewardText = escapeHtml(s.reward_amount_text || 'Check portal');

    document.getElementById('bc-name').textContent = s.scholarship_name || 'Details';

    const cats = s.eligible_categories ? s.eligible_categories.split(/[,;]/).map(c=>`<span class="tag">${escapeHtml(c.trim())}</span>`).join('') : '<span class="tag">All categories</span>';
    const crs  = s.eligible_courses ? s.eligible_courses.split(/[,;]/).map(c=>`<span class="tag">${escapeHtml(c.trim())}</span>`).join('') : '<span class="tag">All courses</span>';

    document.getElementById('detail-grid').innerHTML = `
      <div class="detail-main">
        <div class="detail-hero-band">
          <div class="type-badge ${badge.cls}">${badge.label}</div>
          <div class="detail-title">${scholarshipName}</div>
          <div class="detail-amount-display">
            <div>
              <div class="label">Reward Amount</div>
              <div class="value">${rewardText}</div>
            </div>
          </div>
        </div>
        <div class="detail-body">
          <div class="info-section">
            <div class="info-section-title"><i class="fas fa-users"></i> Eligibility</div>
            <div class="info-row">
              <div class="info-icon"><i class="fas fa-id-card"></i></div>
              <div>
                <div class="info-label">Eligible Categories</div>
                <div class="info-value"><div class="tags-wrap">${cats}</div></div>
              </div>
            </div>
            <div class="info-row">
              <div class="info-icon"><i class="fas fa-graduation-cap"></i></div>
              <div>
                <div class="info-label">Eligible Courses / Streams</div>
                <div class="info-value"><div class="tags-wrap">${crs}</div></div>
              </div>
            </div>
            ${s.min_academic_percentage ? `
            <div class="info-row">
              <div class="info-icon"><i class="fas fa-chart-line"></i></div>
              <div>
                <div class="info-label">Minimum Academic Percentage</div>
                <div class="info-value">${escapeHtml(s.min_academic_percentage)}% or above in qualifying exam</div>
              </div>
            </div>` : ''}
            ${s.max_family_income_inr ? `
            <div class="info-row">
              <div class="info-icon"><i class="fas fa-rupee-sign"></i></div>
              <div>
                <div class="info-label">Maximum Family Income</div>
                <div class="info-value">₹${Number(s.max_family_income_inr).toLocaleString('en-IN')} per annum</div>
              </div>
            </div>` : ''}
          </div>

          <div class="info-section">
            <div class="info-section-title"><i class="fas fa-info-circle"></i> Scholarship Info</div>
            <div class="info-row">
              <div class="info-icon"><i class="fas fa-gift"></i></div>
              <div>
                <div class="info-label">Reward / Award</div>
                <div class="info-value">${escapeHtml(s.reward_amount_text || 'Details available on official portal')}</div>
              </div>
            </div>
            <div class="info-row">
              <div class="info-icon"><i class="fas fa-calendar-alt"></i></div>
              <div>
                <div class="info-label">Application Deadline Month</div>
                <div class="info-value">${escapeHtml(s.deadline_month || 'Check official portal for exact dates')}</div>
              </div>
            </div>
          </div>

          <div class="info-section">
            <div class="info-section-title"><i class="fas fa-link"></i> Apply Now</div>
            <div class="info-row">
              <div class="info-icon"><i class="fas fa-external-link-alt"></i></div>
              <div>
                <div class="info-label">Official Application Link</div>
                <div class="info-value">
                  ${applicationUrl
                    ? `<a href="${escapeHtml(applicationUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--orange);font-weight:600;word-break:break-all;">${escapeHtml(applicationUrl)}</a>`
                    : 'Visit the official scholarship portal to apply.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-sidebar">
        <div class="sidebar-card">
          ${applicationUrl
            ? `<a class="apply-big-btn" href="${escapeHtml(applicationUrl)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-external-link-alt"></i> Apply Now</a>`
            : `<button class="apply-big-btn" style="cursor:default;opacity:0.7"><i class="fas fa-info-circle"></i> Visit Official Portal</button>`}
          <p style="text-align:center;font-size:12px;color:var(--gray);margin-top:12px;">You will be redirected to the official scholarship portal</p>
        </div>

        <div class="sidebar-card">
          <h3>📋 Quick Summary</h3>
          <div class="quick-info">
            <div class="qi-row">
              <span class="qi-label"><i class="fas fa-gift"></i> Reward</span>
              <span class="qi-value">${escapeHtml(s.reward_amount_text || '—')}</span>
            </div>
            <div class="qi-row">
              <span class="qi-label"><i class="fas fa-calendar"></i> Deadline</span>
              <span class="qi-value">${escapeHtml(s.deadline_month || 'Check portal')}</span>
            </div>
            <div class="qi-row">
              <span class="qi-label"><i class="fas fa-percent"></i> Min %</span>
              <span class="qi-value">${s.min_academic_percentage ? escapeHtml(s.min_academic_percentage) + '%' : 'Not specified'}</span>
            </div>
            <div class="qi-row">
              <span class="qi-label"><i class="fas fa-rupee-sign"></i> Income Limit</span>
              <span class="qi-value">${s.max_family_income_inr ? '₹' + Number(s.max_family_income_inr).toLocaleString('en-IN') : 'No limit'}</span>
            </div>
          </div>
        </div>

        <div class="sidebar-card" style="background:linear-gradient(135deg,var(--navy),var(--navy-light));color:white;">
          <h3 style="color:white;margin-bottom:12px;">⚠️ Important Note</h3>
          <p style="font-size:13px;line-height:1.7;color:rgba(255,255,255,0.75);">Always verify details on the official portal before applying. Scholarship amounts and deadlines may change. Scholly India is a discovery platform only.</p>

        </div>
      </div>
    `;

    showPage('detail');
  }

  /* ===== INIT ===== */
  window.addEventListener('DOMContentLoaded', () => {
    loadLandingStats();
  });
