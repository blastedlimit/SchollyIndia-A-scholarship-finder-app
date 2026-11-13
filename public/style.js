  /* ===== STATE ===== */
  let allScholarships = [];
  let filteredData    = [];
  let currentSchol    = null;
  let showingSaved = false;
  let showingTracked = false;
  let currentUser = null;
  let scholarshipTotal = 0;
  let isPreview = false;
  let matchResults = new Map();
  let matchProfileKey = '';
  let pendingResetToken = new URLSearchParams(window.location.search).get('reset') || '';
  const localKeys = { profile: 'scholly-profile', saved: 'scholly-saved', tracker: 'scholly-tracker' };
  const localRead = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const localWrite = (key, value) => localStorage.setItem(key, JSON.stringify(value));

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
    const res = await fetch('/api/scholarships', { cache: 'no-store', credentials: 'same-origin' });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Scholarship API returned a non-JSON response (${res.status}). Check the Netlify function logs and redeploy.`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    const body = await res.json();
    return body;
  }

  async function refreshScholarships() {
    const result = await fetchAll();
    allScholarships = result.data;
    scholarshipTotal = result.totalCount ?? result.count ?? result.data.length;
    isPreview = Boolean(result.preview);
    populateDataFilters(allScholarships);
    updateLandingStats(allScholarships);
    updatePreviewNotice();
    return result;
  }

  function updateAuthNav() {
    const button = document.getElementById('account-action');
    if (!button) return;
    button.innerHTML = currentUser
      ? `<i class="fas fa-user-circle"></i> Hi, ${escapeHtml(currentUser.displayName)} <i class="fas fa-chevron-down account-chevron"></i>`
      : '<i class="fas fa-user-plus"></i> Sign up';
    button.onclick = currentUser ? toggleAccountMenu : () => showAuthDialog('signup');
    const menuName = document.getElementById('account-menu-name');
    const menuEmail = document.getElementById('account-menu-email');
    if (menuName) menuName.textContent = currentUser?.displayName || 'Student account';
    if (menuEmail) menuEmail.textContent = currentUser?.email || '';
    updateSavedControls();
  }

  function toggleAccountMenu() {
    const menu = document.getElementById('account-menu');
    if (menu) menu.hidden = !menu.hidden;
  }

  function closeAccountMenu() {
    const menu = document.getElementById('account-menu');
    if (menu) menu.hidden = true;
  }

  async function viewSavedScholarships() {
    if (!requireAccount()) return;
    closeAccountMenu();
    await goToSearch();
    showingSaved = true;
    showingTracked = false;
    updateSavedControls();
    applyFilters();
  }

  async function viewTrackedApplications() {
    if (!requireAccount()) return;
    closeAccountMenu();
    await goToSearch();
    showingSaved = false;
    showingTracked = true;
    updateSavedControls();
    applyFilters();
  }

  async function openStudentProfile() {
    if (!requireAccount()) return;
    closeAccountMenu();
    await goToSearch();
    document.getElementById('profile-course')?.closest('.filter-group')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('profile-course')?.focus({ preventScroll: true });
  }

  function updatePreviewNotice() {
    const notice = document.getElementById('preview-notice');
    if (!notice) return;
    notice.hidden = !isPreview;
    if (isPreview) {
      notice.innerHTML = `<div><strong>You’re viewing a preview</strong><span>${allScholarships.length} of ${scholarshipTotal} scholarships shown. Create a free account to unlock the full catalogue, save scholarships, and track applications.</span></div><button type="button" onclick="showAuthDialog('signup')">Unlock all scholarships</button>`;
    }
  }

  function showAuthDialog(mode = 'signup') {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    setAuthMode(mode);
    document.getElementById('auth-status').textContent = '';
  }

  function closeAuthDialog() {
    document.getElementById('auth-modal').hidden = true;
    document.body.classList.remove('modal-open');
  }

  function setAuthMode(mode) {
    const modes = ['signup', 'login', 'forgot', 'reset'];
    for (const item of modes) document.getElementById(`${item}-form`).hidden = mode !== item;
    const headings = {
      signup: ['Create your free account', 'Unlock every scholarship and keep your search organized.'],
      login: ['Welcome back', 'Sign in to continue your scholarship search.'],
      forgot: ['Reset your password', 'We’ll email you a secure, one-time reset link.'],
      reset: ['Choose a new password', 'Create a new password for your account.']
    };
    document.getElementById('auth-heading').textContent = headings[mode][0];
    document.querySelector('.auth-intro').textContent = headings[mode][1];
    document.getElementById('auth-switch').hidden = mode === 'forgot' || mode === 'reset';
    if (mode === 'signup') {
      document.getElementById('auth-switch').innerHTML = 'Already have an account? <button type="button" onclick="setAuthMode(\'login\')">Sign in</button>';
    } else if (mode === 'login') {
      document.getElementById('auth-switch').innerHTML = 'New to Scholly India? <button type="button" onclick="setAuthMode(\'signup\')">Create an account</button>';
    }
    document.getElementById('auth-status').textContent = '';
  }

  async function submitAccount(event, mode) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('auth-status');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = 'Please wait…';
    const fields = Object.fromEntries(new FormData(form));
    if (mode === 'reset') {
      if (fields.password !== fields.confirmPassword) {
        status.textContent = 'The passwords do not match.';
        button.disabled = false;
        return;
      }
      fields.token = pendingResetToken;
      delete fields.confirmPassword;
    }
    try {
      const endpoint = { register: 'register', login: 'login', forgot: 'forgot-password', reset: 'reset-password' }[mode];
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not complete your request.');
      if (mode === 'forgot') {
        status.textContent = result.message;
        form.reset();
        return;
      }
      if (mode === 'reset') {
        pendingResetToken = '';
        window.history.replaceState({}, document.title, window.location.pathname);
        setAuthMode('login');
        status.textContent = result.message;
        form.reset();
        return;
      }
      currentUser = result.user;
      updateAuthNav();
      closeAuthDialog();
      const refresh = await refreshScholarships();
      filteredData = [...allScholarships];
      if (document.getElementById('page-search').classList.contains('active')) {
        renderCards(allScholarships);
      }
      document.getElementById('profile-status').textContent = `Welcome, ${currentUser.displayName}! Your account unlocks all ${refresh.totalCount} scholarships.`;
    } catch (error) {
      status.textContent = error instanceof TypeError && error.message === 'Failed to fetch'
        ? 'Cannot reach the signup service. Open Scholly India at http://localhost:3000 (npm run dev), or check that your deployed site has its API configured.'
        : error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    currentUser = null;
    showingSaved = false;
    showingTracked = false;
    closeAccountMenu();
    updateAuthNav();
    await refreshScholarships();
    filteredData = [...allScholarships];
    if (document.getElementById('page-search').classList.contains('active')) renderCards(allScholarships);
  }

  function requireAccount() {
    if (currentUser) return true;
    showAuthDialog('signup');
    return false;
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
      await refreshScholarships();
      filteredData = [...allScholarships];
      renderCards(allScholarships);
    } catch(e) {
      document.getElementById('cards-container').innerHTML =
        `<div class="empty-state"><div class="empty-icon">❌</div><h3>Could not load data</h3><p>${e.message}</p></div>`;
    }
  }

  async function loadLandingStats() {
    try {
      const authResponse = await fetch('/api/auth/me');
      const authBody = await authResponse.json();
      currentUser = authBody.user;
      updateAuthNav();
      await refreshScholarships();
    } catch(e) { /* silent */ }
  }

  function updateLandingStats(data) {
    document.getElementById('total-count').innerHTML = `<span>${scholarshipTotal || data.length}</span>`;
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
    const normalized = selectedCourse.toLowerCase();
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
    if (matchers[normalized]) return matchers[normalized].test(courseText);
    return courseText.split(/[;,]/).some(value => value.trim() === normalized);
  }

  function categoryMatches(s, selectedCategory) {
    const normalize = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const categories = (s.eligible_categories || '').split(/[;,]/).map(normalize).filter(Boolean);
    const gender = (s.target_gender || '').trim().toLowerCase();
    const name = (s.scholarship_name || '').toLowerCase();
    if (!categories.length || categories.some(value => ['all', 'all categories', 'all students', 'open to all', 'any category'].includes(value))) return true;
    if (selectedCategory === 'sc/st') return categories.some(value => ['sc', 'st', 'scheduled caste', 'scheduled tribe'].includes(value));
    if (selectedCategory === 'sc') return categories.some(value => ['sc', 'scheduled caste'].includes(value));
    if (selectedCategory === 'st') return categories.some(value => ['st', 'scheduled tribe'].includes(value));
    if (selectedCategory === 'obc') return categories.some(value => ['obc', 'bc', 'ebc', 'sebc', 'backward class', 'other backward classes'].includes(value));
    if (selectedCategory === 'girls' || selectedCategory === 'female' || selectedCategory === 'women') return gender === 'female' || categories.some(value => ['female', 'girls', 'women'].includes(value));
    if (selectedCategory === 'merit') return name.includes('merit') || Number(s.min_academic_percentage) > 0;
    if (selectedCategory === 'minority') {
      return categories.some(value => ['minority', 'muslim', 'christian', 'sikh', 'buddhist', 'neo buddhist', 'jain', 'parsi', 'zoroastrian'].includes(value));
    }
    if (selectedCategory === 'general') return categories.includes('general') || categories.includes('ews');
    return categories.includes(selectedCategory);
  }

  function readStudentProfile() {
    return {
      category: document.getElementById('profile-category')?.value || '',
      course: document.getElementById('profile-course')?.value || '',
      state: document.getElementById('profile-state')?.value.trim() || '',
      income: document.getElementById('profile-income')?.value || '',
      percent: document.getElementById('profile-percent')?.value || ''
    };
  }

  function profileHasSignals(profile) {
    return Boolean(profile.category || profile.course || profile.state || profile.income || profile.percent);
  }

  function tokenizeMatchText(value) {
    const stopWords = new Set(['the', 'for', 'and', 'with', 'from', 'students', 'student', 'scholarship', 'scheme', 'india', 'all']);
    return String(value || '').toLowerCase().match(/[a-z0-9]+/g)?.filter(token => token.length > 1 && !stopWords.has(token)) || [];
  }

  function profileSearchText(profile) {
    const courseSynonyms = {
      engineering: 'engineering technology btech b tech be bachelor engineering',
      medical: 'medical mbbs nursing pharmacy dental bds healthcare',
      arts: 'arts humanities social sciences literature',
      science: 'science bsc research stem',
      commerce: 'commerce bcom accounting finance',
      law: 'law llb legal',
      management: 'management mba business administration',
      iti: 'iti diploma polytechnic vocational',
      pg: 'postgraduate masters pg',
      phd: 'phd doctorate research'
    };
    const categorySynonyms = {
      sc: 'sc scheduled caste', st: 'st scheduled tribe', obc: 'obc backward classes bc sebc',
      minority: 'minority muslim christian sikh buddhist jain parsi',
      ews: 'ews economically weaker section', general: 'general open category'
    };
    return [
      profile.course,
      courseSynonyms[profile.course] || '',
      profile.category,
      categorySynonyms[profile.category.toLowerCase()] || '',
      profile.state
    ].filter(Boolean).join(' ');
  }

  function calculateProfileMatches(profile) {
    if (!profileHasSignals(profile)) {
      matchResults = new Map();
      matchProfileKey = '';
      return matchResults;
    }

    const profileKey = `${JSON.stringify(profile)}:${allScholarships.length}`;
    if (profileKey === matchProfileKey) return matchResults;
    matchProfileKey = profileKey;

    const documents = allScholarships.map(s => tokenizeMatchText([
      s.scholarship_name, s.provider_name, s.scholarship_type, s.target_state,
      s.target_gender, s.eligible_categories, s.eligible_courses, s.reward_amount_text
    ].join(' ')));
    const documentFrequency = new Map();
    for (const terms of documents) {
      for (const term of new Set(terms)) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
    const idf = new Map([...documentFrequency].map(([term, frequency]) => [
      term, Math.log(1 + (documents.length + 1) / (frequency + 1))
    ]));
    const vectorize = terms => {
      const counts = new Map();
      for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
      const vector = new Map();
      for (const [term, count] of counts) vector.set(term, (count / terms.length) * (idf.get(term) || 0));
      return vector;
    };
    const queryTerms = tokenizeMatchText(profileSearchText(profile));
    const query = vectorize(queryTerms);
    const norm = vector => Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));
    const queryNorm = norm(query);
    const signals = [
      ['Course', 0.28, Boolean(profile.course)],
      ['Category', 0.24, Boolean(profile.category)],
      ['State', 0.18, Boolean(profile.state)],
      ['Family income', 0.16, Boolean(profile.income)],
      ['Academic percentage', 0.14, Boolean(profile.percent)]
    ].filter(([, , active]) => active);

    matchResults = new Map(allScholarships.map((s, index) => {
      const scholarshipVector = vectorize(documents[index]);
      let dot = 0;
      for (const [term, value] of query) dot += value * (scholarshipVector.get(term) || 0);
      const similarity = queryNorm && norm(scholarshipVector) ? dot / (queryNorm * norm(scholarshipVector)) : 0;
      let weightedFit = 0;
      let totalWeight = 0;
      const reasons = [];
      const addSignal = (label, weight, state) => {
        totalWeight += weight;
        weightedFit += weight * (state === 'match' ? 1 : state === 'unknown' ? 0.5 : 0);
        reasons.push(state === 'match' ? `${label} matches` : state === 'unknown' ? `${label} not specified` : `${label} may not fit`);
      };

      if (profile.course) {
        const courses = (s.eligible_courses || '').trim();
        addSignal('Course', 0.28, !courses ? 'unknown' : courses.toLowerCase().split(/[;,]/).some(v => v.trim() === 'all') || courseMatches(s, profile.course) ? 'match' : 'mismatch');
      }
      if (profile.category) {
        const categories = (s.eligible_categories || '').trim();
        addSignal('Category', 0.24, !categories ? 'unknown' : categoryMatches(s, profile.category.toLowerCase()) ? 'match' : 'mismatch');
      }
      if (profile.state) {
        const target = (s.target_state || '').trim().toLowerCase();
        addSignal('State', 0.18, !target ? 'unknown' : target === 'all' || target.includes(profile.state.toLowerCase()) ? 'match' : 'mismatch');
      }
      if (profile.income) {
        const limit = Number(s.max_family_income_inr);
        const knownLimit = Number.isFinite(limit) && limit > 0 && limit < 9999999;
        addSignal('Income', 0.16, !knownLimit ? 'unknown' : Number(profile.income) <= limit ? 'match' : 'mismatch');
      }
      if (profile.percent) {
        const minimum = Number(s.min_academic_percentage);
        const knownMinimum = Number.isFinite(minimum) && minimum > 0;
        addSignal('Marks', 0.14, !knownMinimum ? 'unknown' : Number(profile.percent) >= minimum ? 'match' : 'mismatch');
      }

      const eligibilityFit = totalWeight ? weightedFit / totalWeight : 0;
      const score = Math.round((eligibilityFit * 0.8 + similarity * 0.2) * 100);
      return [s, { score, similarity, reasons: reasons.slice(0, 3) }];
    }));
    return matchResults;
  }

  function updateMatchNotice() {
    const notice = document.getElementById('match-explainer');
    if (!notice) return;
    const enabled = document.getElementById('sort-select')?.value === 'match' && profileHasSignals(readStudentProfile());
    notice.hidden = !enabled;
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
    calculateProfileMatches(readStudentProfile());
    updateMatchNotice();

    let data = allScholarships.filter(s => {
      const savedNames = localRead(localKeys.saved, []);
      const trackedItems = localRead(localKeys.tracker, {});
      if (showingSaved && !savedNames.includes(s.scholarship_name)) return false;
      if (showingTracked && !trackedItems[s.scholarship_name]) return false;
      if (q) {
        const haystack = [
          s.scholarship_name, s.provider_name, s.eligible_categories, s.eligible_courses,
          s.reward_amount_text, s.scholarship_type, s.target_state, s.target_gender, s.deadline_month
        ].map(value => (value || '').toLowerCase()).join(' ');
        if (!q.split(/\s+/).filter(Boolean).every(word => haystack.includes(word))) return false;
      }
      if (cat && !categoryMatches(s, cat)) return false;
      const eligibleCourses = (s.eligible_courses || '').split(/[;,]/).map(value => value.trim().toLowerCase());
      if (course && !eligibleCourses.includes('all') && !courseMatches(s, course)) return false;
      const state = (document.getElementById('f-state')?.value || '').trim().toLowerCase();
      const targetState = (s.target_state || '').trim().toLowerCase();
      if (state && targetState !== 'all' && targetState && !targetState.includes(state)) return false;
      if (deadline && (s.deadline_month || '').toLowerCase() !== 'varies' && !(s.deadline_month || '').toLowerCase().includes(deadline)) return false;
      const incomeLimit = Number(s.max_family_income_inr);
      const incomeDescription = (s.reward_amount_text || '').toLowerCase();
      const hasIncomeLimit = s.max_family_income_inr !== null && s.max_family_income_inr !== '' && Number.isFinite(incomeLimit) && incomeLimit > 0 && incomeLimit < 9999999 && !/income must exceed|income must be above|income above/.test(incomeDescription);
      if (income !== null && Number.isFinite(income) && hasIncomeLimit && incomeLimit < income) return false;
      const minimumPercentage = Number(s.min_academic_percentage);
      const hasMinimumPercentage = s.min_academic_percentage !== null && s.min_academic_percentage !== '' && Number.isFinite(minimumPercentage) && minimumPercentage > 0;
      if (myPct !== null && Number.isFinite(myPct) && hasMinimumPercentage && minimumPercentage > myPct) return false;
      return true;
    });

    if (sort === 'match') data.sort((a, b) => (matchResults.get(b)?.score || 0) - (matchResults.get(a)?.score || 0));
    else if (sort === 'name') data.sort((a, b) => (a.scholarship_name || '').localeCompare(b.scholarship_name || ''));
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
    document.getElementById('f-state').value = '';
    document.getElementById('f-deadline').value = '';
    document.getElementById('f-income').value = '';
    document.getElementById('f-percent').value = '';
    document.getElementById('sort-select').value = 'name';
    showingSaved = false;
    showingTracked = false;
    updateSavedControls();
    filteredData = [...allScholarships];
    renderCards(allScholarships);
  }

  function updateSavedControls() {
    const count = localRead(localKeys.saved, []).length;
    const tracker = localRead(localKeys.tracker, {});
    const trackedCount = Object.values(tracker).filter(Boolean).length;
    const countNode = document.getElementById('saved-count');
    const button = document.getElementById('saved-toggle');
    const accountSavedCount = document.getElementById('account-saved-count');
    const accountTrackedCount = document.getElementById('account-tracked-count');
    if (countNode) countNode.textContent = count;
    if (accountSavedCount) accountSavedCount.textContent = count;
    if (accountTrackedCount) accountTrackedCount.textContent = trackedCount;
    if (button) button.textContent = `${showingSaved ? '★ Showing saved' : '★ View saved'} (${count})`;
  }
  function toggleSavedView() {
    if (!requireAccount()) return;
    showingSaved = !showingSaved;
    showingTracked = false;
    updateSavedControls();
    applyFilters();
    document.getElementById('cards-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function clearSaved() {
    localWrite(localKeys.saved, []);
    showingSaved = false;
    showingTracked = false;
    updateSavedControls();
    applyFilters();
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
    updatePreviewNotice();
    calculateProfileMatches(readStudentProfile());
    updateMatchNotice();

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
      const saved = localRead(localKeys.saved, []).includes(s.scholarship_name);
      const tracked = localRead(localKeys.tracker, {})[s.scholarship_name] || '';
      const match = profileHasSignals(readStudentProfile()) ? matchResults.get(s) : null;
      const matchCard = match ? `<div class="ai-match-card"><strong><i class="fas fa-wand-magic-sparkles"></i> ${match.score}% profile match</strong><span>${escapeHtml(match.reasons.join(' · '))}${match.reasons.length ? ' · ' : ''}Eligibility details may be incomplete; confirm with the provider.</span></div>` : '';
      return `
      <div class="schol-card" onclick="showDetail(${i})" style="animation-delay:${Math.min(i*0.04,0.5)}s">
        <div class="card-type-badge ${badge.cls}">${badge.label}</div>
        <div class="card-name">${escapeHtml(s.scholarship_name || 'Unnamed Scholarship')}</div>
        <div class="card-amount">
          <div class="amount-pill">${escapeHtml(s.reward_amount_text || 'Amount varies')}</div>
        </div>
        ${matchCard}
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
        <div class="student-actions" onclick="event.stopPropagation()">
          <button type="button" onclick="toggleSaved('${escapeHtml(s.scholarship_name).replace(/'/g, '&#39;')}')">${saved ? '★ Saved' : '☆ Save'}</button>
          <label>My status <select aria-label="Application status" onchange="setTracker('${escapeHtml(s.scholarship_name).replace(/'/g, '&#39;')}', this.value)">
            <option value="">Not tracking</option><option ${tracked === 'Interested' ? 'selected' : ''}>Interested</option><option ${tracked === 'Preparing documents' ? 'selected' : ''}>Preparing documents</option><option ${tracked === 'Applied' ? 'selected' : ''}>Applied</option>
          </select></label>
        </div>
      </div>`;
    }).join('');
  }

  function toggleSaved(name) {
    if (!requireAccount()) return;
    const saved = localRead(localKeys.saved, []);
    const next = saved.includes(name) ? saved.filter(value => value !== name) : [...saved, name];
    localWrite(localKeys.saved, next);
    updateSavedControls();
    applyFilters();
  }
  function setTracker(name, status) {
    if (!requireAccount()) {
      applyFilters();
      return;
    }
    const tracker = localRead(localKeys.tracker, {});
    if (status) tracker[name] = status; else delete tracker[name];
    localWrite(localKeys.tracker, tracker);
    updateSavedControls();
  }
  function saveProfile() {
    if (!requireAccount()) return;
    const profile = readStudentProfile();
    if (!profileHasSignals(profile)) {
      document.getElementById('profile-status').textContent = 'Add at least one profile detail to get recommendations.';
      return;
    }
    localWrite(localKeys.profile, profile);
    document.getElementById('profile-status').textContent = 'Profile saved on this device. Ranking scholarships with the smart match model…';
    goToSearch().then(() => {
      clearFilters();
      document.getElementById('sort-select').value = 'match';
      applyFilters();
      document.getElementById('profile-status').textContent = 'Recommendations ranked using profile fit and scholarship text similarity.';
      document.getElementById('cards-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  function reportListing(name) {
    showPage('contact');
    const subject = document.getElementById('contact-subject');
    const message = document.getElementById('contact-message');
    if (subject) subject.value = `Listing report: ${name}`;
    if (message) message.value = `Please review this scholarship listing.\n\nScholarship: ${name}\nIssue or correction: \nOfficial source link (if available): `;
    document.getElementById('contact-status').textContent = 'Please describe the issue, then send your report.';
    message?.focus();
  }
  function populateDataFilters(data) {
    const categorySelect = document.getElementById('f-category');
    const courseSelect = document.getElementById('f-course');
    if (!categorySelect || !courseSelect) return;
    const selectedCat = categorySelect.value;
    const selectedCourse = courseSelect.value;
    const commonCategories = ['SC/ST', 'SC', 'ST', 'OBC', 'Minority', 'General', 'EWS', 'Girls'];
    const categories = [...new Set([...commonCategories, ...data.flatMap(s => (s.eligible_categories || '').split(/[;,]/).map(v => v.trim()).filter(v => v && v.toLowerCase() !== 'all'))])].sort((a,b) => a.localeCompare(b));
    const courses = [...new Set(data.flatMap(s => (s.eligible_courses || '').split(/[;,]/).map(v => v.trim()).filter(v => v && v.toLowerCase() !== 'all')))].sort((a,b) => a.localeCompare(b));
    categorySelect.innerHTML = '<option value="">All Categories</option>' + categories.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    categorySelect.value = categories.find(v => v.toLowerCase() === selectedCat.toLowerCase()) || '';
    const courseGroups = [
      ['engineering', 'Engineering / B.Tech / BE'], ['medical', 'Medical / MBBS'],
      ['arts', 'Arts / Humanities'], ['science', 'Science / B.Sc'], ['commerce', 'Commerce / B.Com'],
      ['law', 'Law / LLB'], ['management', 'Management / MBA'], ['iti', 'ITI / Diploma'],
      ['pg', 'Post Graduate'], ['phd', 'PhD / Research']
    ];
    courseSelect.innerHTML = '<option value="">All Courses</option>' + courseGroups.map(([value,label]) => `<option value="${value}">${label}</option>`).join('') +
      '<optgroup label="Other catalogue courses">' + courses.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') + '</optgroup>';
    courseSelect.value = [...courseSelect.options].some(option => option.value.toLowerCase() === selectedCourse.toLowerCase()) ? selectedCourse : '';
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
                <div class="info-value listing-freshness">Source/verification date not available in this catalogue. Please confirm details on the provider site.</div>
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
          <button class="report-listing-btn" onclick="reportListing('${escapeHtml(s.scholarship_name).replace(/'/g, '&#39;')}')">Report outdated or incorrect information</button>

        </div>
      </div>
    `;

    showPage('detail');
  }

  /* ===== INIT ===== */
  window.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', event => {
      const menu = document.getElementById('account-menu');
      if (menu && !menu.hidden && !menu.contains(event.target) && event.target.id !== 'account-action' && !event.target.closest('#account-action')) {
        closeAccountMenu();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeAccountMenu();
    });
    document.getElementById('auth-close')?.addEventListener('click', closeAuthDialog);
    document.getElementById('auth-modal')?.addEventListener('click', event => {
      if (event.target.id === 'auth-modal') closeAuthDialog();
    });
    document.getElementById('signup-form')?.addEventListener('submit', event => submitAccount(event, 'register'));
    document.getElementById('login-form')?.addEventListener('submit', event => submitAccount(event, 'login'));
    document.getElementById('forgot-form')?.addEventListener('submit', event => submitAccount(event, 'forgot'));
    document.getElementById('reset-form')?.addEventListener('submit', event => submitAccount(event, 'reset'));
    updateSavedControls();
    const profile = localRead(localKeys.profile, {});
    for (const [field, value] of Object.entries({ 'profile-course': profile.course, 'profile-category': profile.category, 'profile-state': profile.state, 'profile-income': profile.income, 'profile-percent': profile.percent })) {
      const input = document.getElementById(field);
      if (input && value) input.value = value;
    }
    document.getElementById('contact-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const subject = document.getElementById('contact-subject').value.trim();
      const message = document.getElementById('contact-message').value.trim();
      const status = document.getElementById('contact-status');
      if (!subject || !message) return;
      const mailto = `mailto:blastedlimit@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      status.textContent = 'Opening your email app to send this message to blastedlimit@gmail.com. If nothing opens, email blastedlimit@gmail.com and include your report.';
      window.location.href = mailto;
    });
    loadLandingStats();
    if (pendingResetToken) showAuthDialog('reset');
  });
