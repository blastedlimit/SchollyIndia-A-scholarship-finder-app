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
      let candidate = String(value || '').trim();
      if (candidate && !/^[a-z][a-z\d+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
      const url = new URL(candidate);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  /* ===== API ===== */
  async function fetchAll() {
    const res = await fetch('/api/scholarships');
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Scholarship API returned a non-JSON response (${res.status}). Check the Netlify function logs and redeploy.`);
    }
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

  async function goToSearch() {
    showPage('search');
    if (allScholarships.length === 0) {
      await loadSearchData();
    } else {
      clearFilters();
    }
  }

  async function filterByCategory(cat) {
    await goToSearch();
    const normalized = cat.trim().toLowerCase();
    const course = document.getElementById('f-course');
    const category = document.getElementById('f-category');
    document.getElementById('search-input').value = '';
    document.getElementById('f-deadline').value = '';
    document.getElementById('f-income').value = '';
    document.getElementById('f-percent').value = '';
    document.getElementById('sort-select').value = 'name';

    if (normalized === 'engineering' || normalized === 'medical') {
      course.value = normalized;
      category.value = '';
    } else {
      course.value = '';
      category.value = normalized === 'sc/st' ? 'SC/ST' : cat;
    }
    applyFilters();
  }

  async function heroSearch() {
    const q = document.getElementById('hero-search-input').value.trim();
    await goToSearch();
    document.getElementById('search-input').value = q;
    applyFilters();
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
  function courseMatches(s, selectedCourse) {
    const courseText = (s.eligible_courses || '').toLowerCase();
    const matchers = {
      engineering: /b\.?\s*tech|btech|(?:^|[^a-z])b\.?\s*e(?:[^a-z]|$)|engineering|technology|\btech\b/i,
      medical: /\b(mbbs|medical|nursing|pharmacy|bds|dental)\b/i,
      arts: /\b(arts?|humanities|social sciences?|general degree|other ug)\b/i,
      science: /\b(b\.?\s*sc|bsc|science|stem|integrated\s*msc|general degree|other ug)\b/i,
      commerce: /\b(b\.?\s*com|bcom|commerce|accountancy|general degree|other ug)\b/i,
      law: /\b(law|llb|legal)\b/i,
      management: /\b(mba|management|business administration|professional ug|other professional)\b/i,
      iti: /\b(iti|diploma|polytechnic|vocational)\b/i,
      pg: /\b(post[\s-]?graduate|masters?|m\.?\s*sc|m\.?\s*tech|m\.?\s*com|mba|pg)\b/i,
      phd: /\b(ph\.?d|research|doctorate)\b/i
    };
    return Boolean(matchers[selectedCourse]?.test(courseText));
  }

  function categoryMatches(s, selectedCategory) {
    const categories = (s.eligible_categories || '').split(/[;,]/).map(value => value.trim().toLowerCase());
    const gender = (s.target_gender || '').trim().toLowerCase();
    const name = (s.scholarship_name || '').toLowerCase();
    if (selectedCategory === 'sc/st') return categories.some(value => value === 'sc' || value === 'st');
    if (selectedCategory === 'girls') return gender === 'female' || categories.some(value => ['female', 'girls', 'women'].includes(value));
    if (selectedCategory === 'merit') return name.includes('merit') || Number(s.min_academic_percentage) > 0;
    if (selectedCategory === 'minority') {
      return categories.some(value => ['minority', 'muslim', 'christian', 'sikh', 'buddhist', 'neo-buddhist', 'jain', 'parsi', 'zoroastrian'].includes(value));
    }
    if (selectedCategory === 'general') return categories.includes('general') || categories.includes('ews');
    return categories.includes(selectedCategory);
  }

  function applyFilters() {
    const q = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
    const cat = (document.getElementById('f-category')?.value || '').trim().toLowerCase();
    const course = document.getElementById('f-course')?.value || '';
    const deadline = (document.getElementById('f-deadline')?.value || '').trim().toLowerCase();
    const incomeValue = document.getElementById('f-income')?.value ?? '';
    const income = incomeValue === '' ? null : Number(incomeValue);
    const percentValue = document.getElementById('f-percent')?.value ?? '';
    const myPct = percentValue === '' ? null : Number(percentValue);
    const sort = document.getElementById('sort-select')?.value || 'name';

    let data = allScholarships.filter(s => {
      if (q) {
        const haystack = [
          s.scholarship_name, s.provider_name, s.eligible_categories, s.eligible_courses,
          s.reward_amount_text, s.scholarship_type, s.target_state, s.target_gender, s.deadline_month
        ].map(value => (value || '').toLowerCase()).join(' ');
        if (!q.split(/\s+/).filter(Boolean).every(word => haystack.includes(word))) return false;
      }
      if (cat && !categoryMatches(s, cat)) return false;
      if (course && !courseMatches(s, course)) return false;
      if (deadline && !(s.deadline_month || '').toLowerCase().includes(deadline)) return false;
      const incomeLimit = Number(s.max_family_income_inr);
      const incomeDescription = (s.reward_amount_text || '').toLowerCase();
      const hasIncomeLimit = s.max_family_income_inr !== null && s.max_family_income_inr !== '' && Number.isFinite(incomeLimit) && incomeLimit > 0 && incomeLimit < 9999999 && !/income must exceed|income must be above|income above/.test(incomeDescription);
      if (income !== null && Number.isFinite(income) && hasIncomeLimit && incomeLimit < income) return false;
      const minimumPercentage = Number(s.min_academic_percentage);
      const hasMinimumPercentage = s.min_academic_percentage !== null && s.min_academic_percentage !== '' && Number.isFinite(minimumPercentage) && minimumPercentage > 0;
      if (myPct !== null && Number.isFinite(myPct) && hasMinimumPercentage && minimumPercentage > myPct) return false;
      return true;
    });

    if (sort === 'name') data.sort((a, b) => (a.scholarship_name || '').localeCompare(b.scholarship_name || ''));
    else if (sort === 'amount') data.sort((a, b) => {
      const amount = value => parseFloat((value || '').replace(/[^0-9.]/g, '')) || 0;
      return amount(b.reward_amount_text) - amount(a.reward_amount_text);
    });
    else if (sort === 'deadline') {
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const deadlineKey = value => {
        const text = (value || '').toLowerCase();
        const month = months.findIndex(name => text.includes(name));
        if (month < 0) return [9999, 99];
        const explicitYear = Number(text.match(/\b20\d{2}\b/)?.[0]);
        const currentMonth = new Date().getMonth();
        const year = explicitYear || new Date().getFullYear() + (month < currentMonth ? 1 : 0);
        return [year, month, explicitYear ? 0 : 1];
      };
      data.sort((a, b) => {
        const [yearA, monthA, precisionA] = deadlineKey(a.deadline_month);
        const [yearB, monthB, precisionB] = deadlineKey(b.deadline_month);
        return yearA - yearB || monthA - monthB || precisionA - precisionB;
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
    document.getElementById('sort-select').value = 'name';
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
            Deadline: ${escapeHtml(s.deadline_month && s.deadline_month.toLowerCase() !== 'varies' ? s.deadline_month : 'Check official portal')}
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
            ${s.max_family_income_inr && Number(s.max_family_income_inr) < 9999999 ? `
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
                <div class="info-value">${escapeHtml(s.deadline_month && s.deadline_month.toLowerCase() !== 'varies' ? s.deadline_month : 'Check official portal for current dates')}</div>
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
              <span class="qi-value">${escapeHtml(s.deadline_month && s.deadline_month.toLowerCase() !== 'varies' ? s.deadline_month : 'Check portal')}</span>
            </div>
            <div class="qi-row">
              <span class="qi-label"><i class="fas fa-percent"></i> Min %</span>
              <span class="qi-value">${s.min_academic_percentage ? escapeHtml(s.min_academic_percentage) + '%' : 'Not specified'}</span>
            </div>
            <div class="qi-row">
              <span class="qi-label"><i class="fas fa-rupee-sign"></i> Income Limit</span>
              <span class="qi-value">${s.max_family_income_inr && Number(s.max_family_income_inr) < 9999999 ? '₹' + Number(s.max_family_income_inr).toLocaleString('en-IN') : 'Not specified'}</span>
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
    document.getElementById('contact-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const subject = document.getElementById('contact-subject').value.trim();
      const message = document.getElementById('contact-message').value.trim();
      const status = document.getElementById('contact-status');
      if (!subject || !message) return;
      const mailto = `mailto:blastedlimit@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      status.textContent = 'Opening your email app to send this message to blastedlimit@gmail.com.';
      window.location.href = mailto;
    });
    loadLandingStats();
  });
