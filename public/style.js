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
let selectedScholarshipStatus = '';
let selectedJobStatus = '';

let allJobs = [];
let jobsLoaded = false;
let jobsPreview = false;
let jobsTotal = 0;
let showSavedJobsOnly = false;
let pendingResetToken = new URLSearchParams(window.location.search).get('reset') || '';

const localKeys = { profile: 'scholly-profile', saved: 'scholly-saved', tracker: 'scholly-tracker', savedJobs: 'scholly-saved-jobs' };
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

function formatLiveDate(dateStr) {
  if (!dateStr) return 'Check official portal';
  const s = String(dateStr).trim();
  // Extract first YYYY-MM-DD from strings like "2027-05-23 (Prelims)" or "2027-01-15 to 2027-01-31 (Tier 1 CBT)"
  const isoMatch = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (!isNaN(d.getTime())) {
      // If the string has extra info (stage notes, ranges), append it cleanly
      const extra = s.replace(/^\d{4}-\d{2}-\d{2}/, '').trim();
      const formatted = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      return extra ? `${formatted} ${extra}` : formatted;
    }
  }
  // Return as-is for already human-readable strings
  return s;
}

function getLiveStatusBadge(status, daysLeft) {
  const s = String(status || '').toUpperCase();
  if (s === 'CLOSING_SOON' || (s === 'OPEN' && daysLeft !== null && daysLeft <= 15 && daysLeft >= 0)) {
    return `<span class="badge-status-closing"><i class="fas fa-fire"></i> Closes in ${daysLeft}d</span>`;
  }
  if (s === 'OPEN') {
    return `<span class="badge-status-open"><span class="live-pulse-dot"></span> Open Now ${daysLeft != null ? `(${daysLeft}d left)` : ''}</span>`;
  }
  if (s === 'UPCOMING') {
    return `<span class="badge-status-upcoming"><i class="fas fa-clock"></i> Upcoming</span>`;
  }
  if (s === 'CLOSED') {
    return `<span class="badge-status-closed"><i class="fas fa-circle-check"></i> Cycle Closed</span>`;
  }
  return `<span class="badge-status-open"><span class="live-pulse-dot"></span> Active</span>`;
}

/* ===== API ===== */
async function fetchAll() {
  const res = await fetch('/api/scholarships', { cache: 'no-store', credentials: 'same-origin' });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Scholarship API returned a non-JSON response (${res.status}). Check server logs and redeploy.`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return await res.json();
}

async function refreshScholarships() {
  const result = await fetchAll();
  allScholarships = result.data;
  scholarshipTotal = result.totalCount ?? result.count ?? result.data.length;
  isPreview = Boolean(result.preview);
  populateDataFilters(allScholarships);
  updateLandingStats(allScholarships);
  updatePreviewNotice();
  updateScholarshipStatusCounts(allScholarships);
  return result;
}

function updateScholarshipStatusCounts(data) {
  let open = 0, closing = 0, upcoming = 0, closed = 0;
  for (const s of data) {
    const st = String(s.listing_status || '').toUpperCase();
    if (st === 'CLOSING_SOON') { closing++; open++; }
    else if (st === 'OPEN') open++;
    else if (st === 'UPCOMING') upcoming++;
    else if (st === 'CLOSED') closed++;
  }
  const elAll = document.getElementById('count-all-schol');
  const elOpen = document.getElementById('count-open-schol');
  const elClosing = document.getElementById('count-closing-schol');
  const elUpcoming = document.getElementById('count-upcoming-schol');
  const elClosed = document.getElementById('count-closed-schol');

  if (elAll) elAll.textContent = data.length;
  if (elOpen) elOpen.textContent = open;
  if (elClosing) elClosing.textContent = closing;
  if (elUpcoming) elUpcoming.textContent = upcoming;
  if (elClosed) elClosed.textContent = closed;
}

function setScholarshipStatusTab(status) {
  selectedScholarshipStatus = status;
  const select = document.getElementById('f-status');
  if (select) select.value = status;

  document.querySelectorAll('#schol-status-tabs .status-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-status') === status);
  });
  applyFilters();
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
    notice.innerHTML = `<div><strong>You're viewing a preview</strong><span>${allScholarships.length} of ${scholarshipTotal} live scholarships shown. Create a free account to unlock the full live catalogue, save scholarships, and track application deadlines.</span></div><button type="button" onclick="showAuthDialog('signup')">Unlock all scholarships</button>`;
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
    signup: ['Create your free account', 'Unlock every active scholarship & vacancy, save deadlines, and keep your applications organized.'],
    login: ['Welcome back', 'Sign in to access your live tracker.'],
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
    jobsLoaded = false;
    await loadJobs();
    document.getElementById('profile-status').textContent = `Welcome, ${currentUser.displayName}! Your account unlocks all ${refresh.totalCount} live opportunities.`;
  } catch (error) {
    status.textContent = error instanceof TypeError && error.message === 'Failed to fetch'
      ? 'Cannot reach the signup service. Open Scholly India at http://localhost:3000 (npm run dev).'
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
  jobsLoaded = false;
  await loadJobs();
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
  const target = document.getElementById('page-' + id);
  if (target) target.classList.add('active');
  window.scrollTo(0,0);
  document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
  if (id === 'landing') document.getElementById('nav-home')?.classList.add('active');
  if (id === 'search') document.getElementById('nav-search')?.classList.add('active');
  if (id === 'jobs' || id === 'job-detail') document.getElementById('nav-jobs')?.classList.add('active');
}

async function goToSearch() {
  showPage('search');
  if (allScholarships.length === 0) {
    await loadSearchData();
  } else {
    clearFilters();
  }
}

async function goToJobs() {
  showPage('jobs');
  if (!jobsLoaded) await loadJobs();
}

async function loadJobs() {
  const grid = document.getElementById('jobs-grid');
  if (grid) grid.innerHTML = '<div class="jobs-loading"><i class="fas fa-spinner fa-spin"></i> Synchronizing live government recruitment feed…</div>';
  try {
    const response = await fetch('/api/jobs', { cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`The jobs API returned a non-JSON response (${response.status}).`);
    }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Could not load jobs (${response.status}).`);
    allJobs = body.data || [];
    jobsPreview = Boolean(body.preview);
    jobsTotal = body.totalCount ?? allJobs.length;
    jobsLoaded = true;
    renderJobResources(body.metadata?.resources || {});
    const sourceDate = document.getElementById('jobs-source-date');
    if (sourceDate) {
      sourceDate.textContent = `Live Synchronized: 2026–2027 Active Cycles`;
    }
    const count = document.getElementById('job-route-count');
    if (count) count.textContent = `${jobsTotal}+`;
    updateJobsPreviewNotice();
    updateJobStatusCounts(allJobs);
    const regionFilter = document.getElementById('jobs-region-filter');
    const regions = [...new Set(allJobs.map(job => job.region).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (regionFilter) {
      regionFilter.innerHTML = '<option value="">All states and regions</option>' + regions.map(region => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join('');
    }
    filterJobs();
  } catch (error) {
    if (grid) grid.innerHTML = `<div class="jobs-empty"><h3>Could not load live government vacancies</h3><p>${escapeHtml(error.message)}</p><button class="jobs-reset" type="button" onclick="jobsLoaded=false;loadJobs()">Try again</button></div>`;
  }
}

function updateJobStatusCounts(jobs) {
  let open = 0, closing = 0, upcoming = 0, closed = 0;
  for (const j of jobs) {
    const st = String(j.listingStatus || '').toUpperCase();
    if (st === 'CLOSING_SOON') { closing++; open++; }
    else if (st === 'OPEN') open++;
    else if (st === 'UPCOMING') upcoming++;
    else if (st === 'CLOSED') closed++;
  }
  const elAll = document.getElementById('count-all-jobs');
  const elOpen = document.getElementById('count-open-jobs');
  const elClosing = document.getElementById('count-closing-jobs');
  const elUpcoming = document.getElementById('count-upcoming-jobs');
  const elClosed = document.getElementById('count-closed-jobs');

  if (elAll) elAll.textContent = jobs.length;
  if (elOpen) elOpen.textContent = open;
  if (elClosing) elClosing.textContent = closing;
  if (elUpcoming) elUpcoming.textContent = upcoming;
  if (elClosed) elClosed.textContent = closed;
}

function setJobStatusTab(status) {
  selectedJobStatus = status;
  const select = document.getElementById('jobs-status-filter');
  if (select) select.value = status;

  document.querySelectorAll('#jobs-status-tabs .status-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-status') === status);
  });
  filterJobs();
}

function updateJobsPreviewNotice() {
  const notice = document.getElementById('jobs-preview-notice');
  if (!notice) return;
  notice.hidden = !jobsPreview;
  if (jobsPreview) {
    notice.innerHTML = `<div><strong>You're viewing a preview</strong><span>${allJobs.length} of ${jobsTotal} government vacancies shown. Create a free account or sign in to browse all active recruitment drives.</span></div><button type="button" onclick="showAuthDialog('signup')">Unlock all vacancies</button>`;
  }
}

function renderJobResources(resources) {
  const heading = document.getElementById('jobs-tools-heading');
  const tools = document.getElementById('jobs-tools-grid');
  const locked = document.getElementById('jobs-tools-lock');
  if (heading) heading.hidden = jobsPreview;
  if (tools) tools.hidden = jobsPreview;
  if (locked) locked.hidden = !jobsPreview;
  if (jobsPreview) return;

  const qualification = document.getElementById('job-qualification-guides');
  if (qualification) qualification.innerHTML = (resources.qualificationFinder || []).map(item => `
    <article class="job-resource-card"><strong>${escapeHtml(item.Qualification || '')}</strong>
      <p>${escapeHtml(item['Recruitment routes to explore'] || '')}</p>
      <p><b>Reminder:</b> ${escapeHtml(item['Eligibility reminder'] || '')}</p>
      <p><b>Routes:</b> ${escapeHtml(item['Related IDs / sheets'] || '')}</p>
      <p><b>Key Info:</b> ${escapeHtml(item['Important limitation'] || '')}</p>
    </article>`).join('');

  const checklist = document.getElementById('job-application-checklist');
  if (checklist) checklist.innerHTML = `<div class="job-checklist">${(resources.applicationChecklist || []).map((item, index) => `
    <div class="job-checklist-item"><span>${escapeHtml(item.Step || String(index + 1))}</span><div><strong>${escapeHtml(item.Check || '')}</strong><br>${escapeHtml(item['What to verify'] || '')}</div></div>`).join('')}</div>`;

  const planner = document.getElementById('job-month-planner');
  if (planner) planner.innerHTML = (resources.monthPlanner || []).map(item => `
    <article class="job-resource-card"><strong>${escapeHtml(item['Exam family'] || '')}</strong>
      <p><b>Application Window:</b> ${escapeHtml(item['Application watch window'] || '')}</p>
      <p><b>Exam Schedule:</b> ${escapeHtml(item['Exam watch window'] || '')}</p>
      <p>${escapeHtml(item['How to use safely'] || '')}</p>
    </article>`).join('');

  const directory = document.getElementById('job-source-directory');
  if (directory) {
    const states = (resources.stateDirectory || []).map(item => {
      const url = getApplicationUrl(item['Official gateway']);
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(item['State / UT'] || '')}:</strong> ${escapeHtml(item['Primary recruiting authority'] || '')} ↗</a>` : '';
    }).join('');
    const sources = (resources.officialSources || []).map(item => {
      const url = getApplicationUrl(item.URL);
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(item['Source ID'] || '')}:</strong> ${escapeHtml(item['Official document / gateway'] || '')} ↗</a>` : '';
    }).join('');
    directory.innerHTML = `<h4 class="job-resource-heading">State and UT gateways</h4><div class="job-directory-list">${states}</div><h4 class="job-resource-heading">Official source index</h4><div class="job-directory-list">${sources}</div>`;
  }
}

function clearJobFilters() {
  showSavedJobsOnly = false;
  selectedJobStatus = '';
  document.querySelectorAll('#jobs-status-tabs .status-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-status') === '');
  });
  for (const id of ['jobs-query', 'jobs-sheet-filter', 'jobs-region-filter', 'jobs-qualification-filter', 'jobs-status-filter']) {
    const control = document.getElementById(id);
    if (control) control.value = '';
  }
  const savedToggle = document.getElementById('jobs-saved-toggle');
  if (savedToggle) savedToggle.innerHTML = '<i class="far fa-bookmark"></i> View saved routes';
  filterJobs();
}

function toggleSavedJobsView() {
  showSavedJobsOnly = !showSavedJobsOnly;
  const button = document.getElementById('jobs-saved-toggle');
  if (button) button.innerHTML = showSavedJobsOnly ? '<i class="fas fa-bookmark"></i> Showing saved routes' : '<i class="far fa-bookmark"></i> View saved routes';
  filterJobs();
}

function toggleSavedJob(jobId) {
  const saved = new Set(localRead(localKeys.savedJobs, []));
  if (saved.has(jobId)) saved.delete(jobId); else saved.add(jobId);
  localWrite(localKeys.savedJobs, [...saved]);
  filterJobs();
}

function filterJobs() {
  const query = (document.getElementById('jobs-query')?.value || '').trim().toLowerCase();
  const sheet = document.getElementById('jobs-sheet-filter')?.value || '';
  const region = document.getElementById('jobs-region-filter')?.value || '';
  const qualification = document.getElementById('jobs-qualification-filter')?.value || '';
  const statusFilter = (document.getElementById('jobs-status-filter')?.value || selectedJobStatus || '').toUpperCase();
  const saved = new Set(localRead(localKeys.savedJobs, []));

  const matchesQualification = job => {
    const value = `${job.qualification || ''} ${job.minimumMarks || ''}`.toLowerCase();
    if (!qualification) return true;
    const patterns = {
      '8th': /8th|class viii|middle school/, '10th': /10th|class x|matric/,
      '12th': /12th|class xii|senior secondary|higher secondary/,
      iti: /\biti\b|industrial training/, diploma: /diploma|polytechnic/,
      bachelor: /bachelor|graduate|degree|\bllb\b|b\.? ?tech|b\.? ?e\b/,
      degree: /degree|graduate|bachelor|master|\bllb\b/,
      engineering: /engineering|\bb\.? ?tech\b|\bb\.? ?e\b|\bm\.? ?tech\b/,
      medical: /medical|mbbs|nursing|pharmacy|doctor/,
      law: /\blaw\b|\bllb\b|judicial|legal/
    };
    return patterns[qualification]?.test(value) || false;
  };

  const results = allJobs.filter(job => {
    if (sheet && job.sourceSheet !== sheet) return false;
    if (region && job.region !== region) return false;
    if (showSavedJobsOnly && !saved.has(job.jobId)) return false;
    if (!matchesQualification(job)) return false;

    // Status filter
    if (statusFilter) {
      const jStatus = String(job.listingStatus || '').toUpperCase();
      if (statusFilter === 'OPEN' && (jStatus !== 'OPEN' && jStatus !== 'CLOSING_SOON')) return false;
      if (statusFilter === 'CLOSING_SOON' && jStatus !== 'CLOSING_SOON') return false;
      if (statusFilter === 'UPCOMING' && jStatus !== 'UPCOMING') return false;
      if (statusFilter === 'CLOSED' && jStatus !== 'CLOSED') return false;
    }

    return !query || Object.values(job).some(value => String(value || '').toLowerCase().includes(query));
  });

  const sort = document.getElementById('jobs-sort-select')?.value || 'closing_asc';
  results.sort((a, b) => {
    if (sort === 'closing_asc') {
      const aDate = a.applicationCloseDate || '9999-99-99';
      const bDate = b.applicationCloseDate || '9999-99-99';
      return aDate.localeCompare(bDate);
    }
    if (sort === 'region') {
      return String(a.region || a.employmentType || '').localeCompare(String(b.region || b.employmentType || '')) || String(a.title || '').localeCompare(String(b.title || ''));
    }
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  const count = document.getElementById('jobs-result-count');
  if (count) count.textContent = results.length;
  renderJobs(results);
}

function renderJobs(jobs) {
  const grid = document.getElementById('jobs-grid');
  if (!grid) return;
  if (!allJobs.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fas fa-landmark"></i></div><h3>Loading government vacancies…</h3></div>';
    return;
  }
  if (!jobs.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fas fa-magnifying-glass"></i></div><h3>No active vacancies match your criteria</h3><p>Try clearing filters or changing status tabs to see more opportunities.</p></div>';
    return;
  }
  const saved = new Set(localRead(localKeys.savedJobs, []));
  const sheetLabel = { 'National Exams': 'National Exam', 'State-UT Routes': 'State / UT Vacancy', 'Sector Routes': 'Specialist Sector' };

  grid.innerHTML = jobs.map((job, i) => {
    const routeSummary = job.roles || job.recruitmentFamily || job.selection || '';
    const location = job.region || job.employmentType || 'All India';
    const qualification = job.qualification || 'Check current notice';
    const selected = saved.has(job.jobId);
    const jobId = escapeHtml(job.jobId);
    const statusBadge = getLiveStatusBadge(job.listingStatus, job.daysLeft);
    const vacanciesText = job.vacancies || 'Multiple Posts';
    const payText = job.salaryOrPay || 'Govt Pay Scale';
    const applyWindow = job.applicationCloseDate ? `${formatLiveDate(job.applicationOpenDate)} – ${formatLiveDate(job.applicationCloseDate)}` : 'Active Notification Cycle';
    const examDate = job.examDate ? formatLiveDate(job.examDate) : 'Refer to Portal';

    return `<article class="schol-card job-result-card" role="button" tabindex="0" onclick="showJobDetail('${jobId}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showJobDetail('${jobId}')}" style="animation-delay:${Math.min(i*0.04,0.5)}s">
      <div class="card-top-row">
        <span class="card-type-badge ${job.sourceSheet === 'State-UT Routes' ? 'badge-state' : 'badge-national'}">${escapeHtml(sheetLabel[job.sourceSheet] || job.kind || 'Career')}</span>
        ${statusBadge}
      </div>
      <div class="card-name">${escapeHtml(job.title || job.recruitmentFamily || 'Government Recruitment')}</div>
      <div class="job-card-recruiter">${escapeHtml(job.recruiter || job.employmentType || '')}</div>
      ${routeSummary ? `<p class="job-card-summary">${escapeHtml(routeSummary)}</p>` : ''}
      
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin: 10px 0;">
        <span class="vacancies-pill"><i class="fas fa-users-gear"></i> ${escapeHtml(vacanciesText)}</span>
        <span class="pay-pill"><i class="fas fa-indian-rupee-sign"></i> ${escapeHtml(payText)}</span>
      </div>

      <!-- LIVE DATES BOX -->
      <div class="card-dates-box">
        <div class="card-dates-row">
          <span class="card-dates-label"><i class="fas fa-calendar-check" style="color:#059669"></i> Application Window:</span>
          <span class="card-dates-value">${escapeHtml(applyWindow)}</span>
        </div>
        ${job.examDate ? `
        <div class="card-dates-row" style="margin-top:4px;">
          <span class="card-dates-label"><i class="fas fa-pen-nib" style="color:#2563eb"></i> Exam Date:</span>
          <span class="card-dates-value">${escapeHtml(examDate)}</span>
        </div>` : ''}
      </div>

      <div class="card-meta">
        <span class="meta-chip"><i class="fas fa-graduation-cap"></i> ${escapeHtml(qualification)}</span>
        <span class="meta-chip"><i class="fas fa-location-dot"></i> ${escapeHtml(location)}</span>
      </div>

      <div class="card-footer">
        <div class="card-deadline"><i class="fas fa-hourglass-half"></i> ${job.daysLeft >= 0 ? `${job.daysLeft} days left` : 'Cycle ended'}</div>
        <button class="view-btn" type="button" onclick="event.stopPropagation();showJobDetail('${jobId}')">View Live Details <i class="fas fa-arrow-right"></i></button>
      </div>
      <div class="student-actions" onclick="event.stopPropagation()">
        <button type="button" onclick="toggleSavedJob('${jobId}')">${selected ? '★ Saved Route' : '☆ Save Route'}</button>
      </div>
    </article>`;
  }).join('');
}

function showJobDetail(jobId) {
  const job = allJobs.find(item => item.jobId === jobId);
  if (!job) return;
  const title = job.title || job.recruitmentFamily || 'Government Career Route';
  const url = getApplicationUrl(job.officialUrl);
  const detailRow = (icon, label, value) => value ? `<div class="info-row"><div class="info-icon"><i class="fas ${icon}"></i></div><div><div class="info-label">${escapeHtml(label)}</div><div class="info-value">${escapeHtml(value)}</div></div></div>` : '';
  const sourceSheet = { 'National Exams': 'National Exam Cycle', 'State-UT Routes': 'State / UT Recruitment', 'Sector Routes': 'Specialist Sector' }[job.sourceSheet] || 'Recruitment';
  const saved = new Set(localRead(localKeys.savedJobs, []));
  const jobIdSafe = escapeHtml(job.jobId);
  const statusBadge = getLiveStatusBadge(job.listingStatus, job.daysLeft);

  document.getElementById('job-bc-name').textContent = title;
  document.getElementById('job-detail-grid').innerHTML = `
    <div class="detail-main">
      <div class="detail-hero-band job-detail-hero">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
          <span class="job-detail-badge">${escapeHtml(sourceSheet)}</span>
          ${statusBadge}
        </div>
        <div class="detail-title">${escapeHtml(title)}</div>
        <p class="job-detail-subtitle">${escapeHtml(job.roles || job.recruitmentFamily || job.recruiter || '')}</p>
        <div class="job-detail-location"><i class="fas fa-location-dot"></i> ${escapeHtml(job.region || job.employmentType || 'All India')}</div>
      </div>

      <div class="detail-body">
        <!-- LIVE DATES TIMELINE -->
        <div class="timeline-container">
          <div class="info-section-title"><i class="fas fa-calendar-days"></i> Confirmed 2026–2027 Recruitment Schedule</div>
          <div class="timeline-grid">
            <div class="timeline-step ${job.listingStatus === 'OPEN' || job.listingStatus === 'CLOSING_SOON' ? 'active' : ''}">
              <div class="t-icon"><i class="fas fa-folder-open"></i></div>
              <div class="t-label">Applications Open</div>
              <div class="t-date">${formatLiveDate(job.applicationOpenDate)}</div>
            </div>
            <div class="timeline-step ${job.daysLeft <= 15 && job.daysLeft >= 0 ? 'urgent' : ''}">
              <div class="t-icon"><i class="fas fa-calendar-xmark"></i></div>
              <div class="t-label">Last Date to Apply</div>
              <div class="t-date">${formatLiveDate(job.applicationCloseDate)}</div>
            </div>
            <div class="timeline-step">
              <div class="t-icon"><i class="fas fa-id-badge"></i></div>
              <div class="t-label">Admit Card</div>
              <div class="t-date">${formatLiveDate(job.admitCardDate)}</div>
            </div>
            <div class="timeline-step">
              <div class="t-icon"><i class="fas fa-pen-nib"></i></div>
              <div class="t-label">Exam / Screening</div>
              <div class="t-date">${formatLiveDate(job.examDate)}</div>
            </div>
          </div>
        </div>

        <section class="info-section">
          <div class="info-section-title"><i class="fas fa-briefcase"></i> Vacancies & Compensation</div>
          ${detailRow('fa-users-gear', 'Total Notified Vacancies / Posts', job.vacancies || 'See detailed notification')}
          ${detailRow('fa-indian-rupee-sign', 'Pay Scale & Emoluments', job.salaryOrPay || 'Govt pay scale applicable')}
          ${detailRow('fa-money-bill-wave', 'Application Fee', job.applicationFee || '₹100 (Exemptions for SC/ST/Female/PwD)')}
        </section>

        <section class="info-section">
          <div class="info-section-title"><i class="fas fa-user-check"></i> Eligibility Criteria</div>
          ${detailRow('fa-graduation-cap', 'Minimum Educational Qualification', job.qualification)}
          ${detailRow('fa-percent', 'Minimum Qualifying Marks', job.minimumMarks || 'Pass class / recognized equivalent')}
          ${detailRow('fa-user-clock', 'Age Limit & Cut-off', job.ageLimit || job.age || 'Refer to notification')}
          ${detailRow('fa-passport', 'Nationality & Domicile', job.eligibility || 'Citizen of India')}
          ${detailRow('fa-clipboard-list', 'Additional Requirements / Skills', job.additionalRequirements)}
        </section>

        <section class="info-section">
          <div class="info-section-title"><i class="fas fa-route"></i> Selection Process & Exam Stages</div>
          ${detailRow('fa-list-check', 'Selection Stages', job.selectionStages || job.selection || 'Written Test → Skill/Interview → Document Verification')}
          ${detailRow('fa-circle-info', 'Official Source Reference', job.sourceId ? `Reference ID: ${job.sourceId}` : 'Recruiting Authority Official Notice')}
        </section>

        <section class="info-section">
          <div class="info-section-title"><i class="fas fa-list-ol"></i> Step-by-Step How to Apply</div>
          <div class="checklist-box">
            ${(job.howToApply || [
              `Step 1: Verify your qualification requirements on Scholly India and visit the official gateway at ${job.officialUrl}`,
              'Step 2: Complete the One-Time Registration (OTR) with your mobile number and Aadhaar.',
              'Step 3: Fill in your personal information, address, and upload educational certificates and photo.',
              'Step 4: Pay the applicable examination fee through the online payment gateway.',
              'Step 5: Download and save the final application acknowledgement slip with Registration Number.'
            ]).map((step, i) => `
              <div class="checklist-item">
                <i class="fas fa-circle-check"></i>
                <div>${escapeHtml(step)}</div>
              </div>
            `).join('')}
          </div>
        </section>
      </div>
    </div>

    <aside class="detail-sidebar">
      <div class="sidebar-card job-portal-card">
        ${url ? `<a class="apply-big-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square"></i> Apply Online Now</a>` : `<div class="job-source-placeholder"><i class="fas fa-circle-info"></i><span>${escapeHtml(job.officialUrl || 'Use the recruiting authority named in the notification.')}</span></div>`}
        <p class="job-portal-note">Direct verified link to the official application gateway</p>
        <button class="job-save-detail ${saved.has(job.jobId) ? 'saved' : ''}" type="button" onclick="toggleSavedJob('${jobIdSafe}');showJobDetail('${jobIdSafe}')">
          ${saved.has(job.jobId) ? '★ Saved in My Tracker' : '☆ Save this Route'}
        </button>
      </div>
      <div class="sidebar-card">
        <h3>📋 Live Vacancy Summary</h3>
        <div class="quick-info">
          <div class="qi-row"><span class="qi-label"><i class="fas fa-building"></i> Recruiter</span><span class="qi-value">${escapeHtml(job.recruiter || 'Govt Department')}</span></div>
          <div class="qi-row"><span class="qi-label"><i class="fas fa-users"></i> Vacancies</span><span class="qi-value">${escapeHtml(job.vacancies || 'Open')}</span></div>
          <div class="qi-row"><span class="qi-label"><i class="fas fa-calendar"></i> Deadline</span><span class="qi-value">${formatLiveDate(job.applicationCloseDate)}</span></div>
          <div class="qi-row"><span class="qi-label"><i class="fas fa-pen"></i> Exam Date</span><span class="qi-value">${formatLiveDate(job.examDate)}</span></div>
          <div class="qi-row"><span class="qi-label"><i class="fas fa-wallet"></i> Fee</span><span class="qi-value">${escapeHtml(job.applicationFee || '₹100 / Nil')}</span></div>
        </div>
      </div>
    </aside>`;
  showPage('job-detail');
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
  document.getElementById('sort-select').value = 'deadline_asc';

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
  const q = document.getElementById('hero-search-input')?.value.trim() || '';
  await goToSearch();
  document.getElementById('search-input').value = q;
  applyFilters();
}

/* ===== LOAD SEARCH DATA ===== */
async function loadSearchData() {
  document.getElementById('cards-container').innerHTML =
    '<div class="loader"><div class="spinner"></div><p>Fetching live scholarships from database…</p></div>';
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
  const totalCountEl = document.getElementById('total-count');
  if (totalCountEl) totalCountEl.innerHTML = `<span>${scholarshipTotal || data.length}</span>`;
  const withAmount = data.filter(s => s.reward_amount_text);
  if (withAmount.length) {
    const sorted = withAmount.sort((a,b) => {
      const aNum = parseFloat((a.reward_amount_text||'').replace(/[^0-9.]/g,'')) || 0;
      const bNum = parseFloat((b.reward_amount_text||'').replace(/[^0-9.]/g,'')) || 0;
      return bNum - aNum;
    });
    const topRewardEl = document.getElementById('top-reward');
    if (topRewardEl) topRewardEl.textContent = sorted[0].reward_amount_text || '—';
  }
}

function courseMatches(s, selectedCourse) {
  const courseText = (s.eligible_courses || '').toLowerCase();
  const normalized = selectedCourse.toLowerCase();
  const matchers = {
    engineering: /b\.?\s*tech|btech|(?:^|[^a-z])b\.?\s*e(?:[^a-z]|$)|engineering|technology|\btech\b/i,
    medical: /\b(mbbs|medical|nursing|pharmacy|bds|dental|doctor)\b/i,
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

function calculateProfileMatches(profile) {
  if (!profileHasSignals(profile)) {
    matchResults = new Map();
    matchProfileKey = '';
    return matchResults;
  }
  const profileKey = `${JSON.stringify(profile)}:${allScholarships.length}`;
  if (profileKey === matchProfileKey) return matchResults;
  matchProfileKey = profileKey;

  matchResults = new Map(allScholarships.map(s => {
    let score = 50;
    const reasons = [];
    if (profile.course && courseMatches(s, profile.course)) {
      score += 20;
      reasons.push('Course matches your stream');
    }
    if (profile.category && categoryMatches(s, profile.category.toLowerCase())) {
      score += 15;
      reasons.push('Eligible for your category');
    }
    if (profile.income && Number(s.max_family_income_inr) >= Number(profile.income)) {
      score += 10;
      reasons.push('Family income within limit');
    }
    if (profile.percent && (!s.min_academic_percentage || Number(profile.percent) >= Number(s.min_academic_percentage))) {
      score += 5;
      reasons.push('Meets academic percentage criteria');
    }
    return [s, { score: Math.min(score, 98), reasons: reasons.slice(0, 3) }];
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
  const statusFilter = (document.getElementById('f-status')?.value || selectedScholarshipStatus || '').toUpperCase();
  const incomeValue = document.getElementById('f-income')?.value ?? '';
  const income = incomeValue === '' ? null : Number(incomeValue);
  const percentValue = document.getElementById('f-percent')?.value ?? '';
  const myPct = percentValue === '' ? null : Number(percentValue);
  const sort = document.getElementById('sort-select')?.value || 'deadline_asc';

  calculateProfileMatches(readStudentProfile());
  updateMatchNotice();

  let data = allScholarships.filter(s => {
    const savedNames = localRead(localKeys.saved, []);
    const trackedItems = localRead(localKeys.tracker, {});
    if (showingSaved && !savedNames.includes(s.scholarship_name)) return false;
    if (showingTracked && !trackedItems[s.scholarship_name]) return false;

    // Status filter
    if (statusFilter) {
      const sStatus = String(s.listing_status || '').toUpperCase();
      if (statusFilter === 'OPEN' && (sStatus !== 'OPEN' && sStatus !== 'CLOSING_SOON')) return false;
      if (statusFilter === 'CLOSING_SOON' && sStatus !== 'CLOSING_SOON') return false;
      if (statusFilter === 'UPCOMING' && sStatus !== 'UPCOMING') return false;
      if (statusFilter === 'CLOSED' && sStatus !== 'CLOSED') return false;
    }

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
    const hasIncomeLimit = s.max_family_income_inr !== null && s.max_family_income_inr !== '' && Number.isFinite(incomeLimit) && incomeLimit > 0 && incomeLimit < 9999999;
    if (income !== null && Number.isFinite(income) && hasIncomeLimit && income > incomeLimit) return false;

    const minimumPercentage = Number(s.min_academic_percentage);
    const hasMinimumPercentage = s.min_academic_percentage !== null && s.min_academic_percentage !== '' && Number.isFinite(minimumPercentage) && minimumPercentage > 0;
    if (myPct !== null && Number.isFinite(myPct) && hasMinimumPercentage && minimumPercentage > myPct) return false;

    return true;
  });

  if (sort === 'deadline_asc') {
    data.sort((a, b) => {
      const aDate = a.close_date || '9999-99-99';
      const bDate = b.close_date || '9999-99-99';
      return aDate.localeCompare(bDate);
    });
  } else if (sort === 'match') {
    data.sort((a, b) => (matchResults.get(b)?.score || 0) - (matchResults.get(a)?.score || 0));
  } else if (sort === 'name') {
    data.sort((a, b) => (a.scholarship_name || '').localeCompare(b.scholarship_name || ''));
  } else if (sort === 'amount') {
    const amount = value => parseFloat((value || '').replace(/[^0-9.]/g, '')) || 0;
    data.sort((a, b) => amount(b.reward_amount_text) - amount(a.reward_amount_text));
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
  document.getElementById('f-status').value = '';
  document.getElementById('sort-select').value = 'deadline_asc';
  selectedScholarshipStatus = '';
  document.querySelectorAll('#schol-status-tabs .status-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-status') === '');
  });
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
  return { cls: 'badge-default', label: '🏢 Direct' };
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
        <p>Try adjusting your filters or status tabs to view more opportunities.</p>
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
    const matchCard = match ? `<div class="ai-match-card"><strong><i class="fas fa-wand-magic-sparkles"></i> ${match.score}% profile match</strong><span>${escapeHtml(match.reasons.join(' · '))}.</span></div>` : '';
    const statusBadge = getLiveStatusBadge(s.listing_status, s.days_left);
    const applyWindow = s.close_date ? `${formatLiveDate(s.open_date)} – ${formatLiveDate(s.close_date)}` : 'Annual cycle active';
    const quotaText = s.seats_quota || 'All Eligible Students';

    return `
    <div class="schol-card" onclick="showDetail(${i})" style="animation-delay:${Math.min(i*0.04,0.5)}s">
      <div class="card-top-row">
        <span class="card-type-badge ${badge.cls}">${badge.label}</span>
        ${statusBadge}
      </div>
      <div class="card-name">${escapeHtml(s.scholarship_name || 'Scholarship Scheme')}</div>
      <div class="card-amount">
        <div class="amount-pill">${escapeHtml(s.reward_amount_text || 'Scholarship grant')}</div>
      </div>
      ${matchCard}

      <!-- LIVE DATES & SEATS BOX -->
      <div class="card-dates-box">
        <div class="card-dates-row">
          <span class="card-dates-label"><i class="fas fa-calendar-check" style="color:#059669"></i> Application Window:</span>
          <span class="card-dates-value">${escapeHtml(applyWindow)}</span>
        </div>
        <div class="card-dates-row" style="margin-top:4px;">
          <span class="card-dates-label"><i class="fas fa-users-viewfinder" style="color:#2563eb"></i> Beneficiaries:</span>
          <span class="card-dates-value" style="font-size:11px;">${escapeHtml(quotaText)}</span>
        </div>
      </div>

      <div class="card-meta">
        <div class="meta-chip"><i class="fas fa-users"></i> ${cats}</div>
        <div class="meta-chip"><i class="fas fa-book"></i> ${crs}</div>
        ${s.min_academic_percentage ? `<div class="meta-chip"><i class="fas fa-percent"></i> ${escapeHtml(s.min_academic_percentage)}%+</div>` : ''}
      </div>

      <div class="card-footer">
        <div class="card-deadline">
          <i class="fas fa-hourglass-half"></i>
          ${s.days_left >= 0 ? `${s.days_left} days left` : 'Cycle ended'}
        </div>
        <button class="view-btn">View Live Details <i class="fas fa-arrow-right"></i></button>
      </div>
      <div class="student-actions" onclick="event.stopPropagation()">
        <button type="button" onclick="toggleSaved('${escapeHtml(s.scholarship_name).replace(/'/g, '&#39;')}')">${saved ? '★ Saved' : '☆ Save'}</button>
        <label>Status <select aria-label="Application status" onchange="setTracker('${escapeHtml(s.scholarship_name).replace(/'/g, '&#39;')}', this.value)">
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
    document.getElementById('profile-status').textContent = 'Recommendations ranked using profile fit and live eligibility.';
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
  const rewardText = escapeHtml(s.reward_amount_text || 'Scholarship grant');
  const statusBadge = getLiveStatusBadge(s.listing_status, s.days_left);

  document.getElementById('bc-name').textContent = s.scholarship_name || 'Details';

  const cats = s.eligible_categories ? s.eligible_categories.split(/[,;]/).map(c=>`<span class="tag">${escapeHtml(c.trim())}</span>`).join('') : '<span class="tag">All categories</span>';
  const crs  = s.eligible_courses ? s.eligible_courses.split(/[,;]/).map(c=>`<span class="tag">${escapeHtml(c.trim())}</span>`).join('') : '<span class="tag">All courses</span>';

  document.getElementById('detail-grid').innerHTML = `
    <div class="detail-main">
      <div class="detail-hero-band">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
          <div class="type-badge ${badge.cls}">${badge.label}</div>
          ${statusBadge}
        </div>
        <div class="detail-title">${scholarshipName}</div>
        <div class="detail-amount-display">
          <div>
            <div class="label">Reward / Financial Assistance</div>
            <div class="value">${rewardText}</div>
          </div>
        </div>
      </div>

      <div class="detail-body">
        <!-- LIVE APPLICATION TIMELINE -->
        <div class="timeline-container">
          <div class="info-section-title"><i class="fas fa-calendar-days"></i> 2026–2027 Live Application Schedule</div>
          <div class="timeline-grid">
            <div class="timeline-step ${s.listing_status === 'OPEN' || s.listing_status === 'CLOSING_SOON' ? 'active' : ''}">
              <div class="t-icon"><i class="fas fa-door-open"></i></div>
              <div class="t-label">Applications Open</div>
              <div class="t-date">${formatLiveDate(s.open_date)}</div>
            </div>
            <div class="timeline-step ${s.days_left <= 15 && s.days_left >= 0 ? 'urgent' : ''}">
              <div class="t-icon"><i class="fas fa-hourglass-end"></i></div>
              <div class="t-label">Application Deadline</div>
              <div class="t-date">${formatLiveDate(s.close_date)}</div>
            </div>
            <div class="timeline-step">
              <div class="t-icon"><i class="fas fa-school-flag"></i></div>
              <div class="t-label">Institute Verification</div>
              <div class="t-date">${formatLiveDate(s.verification_deadline)}</div>
            </div>
            <div class="timeline-step">
              <div class="t-icon"><i class="fas fa-money-bill-transfer"></i></div>
              <div class="t-label">Disbursement Mode</div>
              <div class="t-date">Direct DBT via PFMS</div>
            </div>
          </div>
        </div>

        <div class="info-section">
          <div class="info-section-title"><i class="fas fa-users"></i> Eligibility Matrix</div>
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
              <div class="info-value">${escapeHtml(s.min_academic_percentage)}% or above in qualifying examination</div>
            </div>
          </div>` : ''}
          ${s.max_family_income_inr && Number(s.max_family_income_inr) < 9999999 ? `
          <div class="info-row">
            <div class="info-icon"><i class="fas fa-rupee-sign"></i></div>
            <div>
              <div class="info-label">Maximum Family Income Ceiling</div>
              <div class="info-value">₹${Number(s.max_family_income_inr).toLocaleString('en-IN')} per annum</div>
            </div>
          </div>` : ''}
          <div class="info-row">
            <div class="info-icon"><i class="fas fa-users-viewfinder"></i></div>
            <div>
              <div class="info-label">Total Beneficiaries / Quota</div>
              <div class="info-value">${escapeHtml(s.seats_quota || 'All Eligible Candidates')}</div>
            </div>
          </div>
        </div>

        <div class="info-section">
          <div class="info-section-title"><i class="fas fa-file-lines"></i> Mandatory Documents Required</div>
          <div class="checklist-box">
            ${(s.documents_required || [
              'Aadhaar Card (linked with active bank account for DBT)',
              'Current Admission Year Bonafide Student Certificate / College ID Card',
              'Previous Year / Semester Marksheet',
              'Competent Authority Family Income Certificate',
              'Caste / Community Certificate (SC/ST/OBC/EWS if applicable)',
              'Bank Passbook Copy showing student name, IFSC code, and account number'
            ]).map(doc => `
              <div class="checklist-item">
                <i class="fas fa-circle-check"></i>
                <div>${escapeHtml(doc)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="info-section">
          <div class="info-section-title"><i class="fas fa-list-check"></i> Step-by-Step How to Apply</div>
          <div class="checklist-box">
            ${(s.how_to_apply || [
              'Step 1: Verify eligibility criteria (Marks, Category, Family Income, and Course).',
              `Step 2: Visit the official portal at ${s.application_link}`,
              'Step 3: Register and generate your student login / One-Time Registration (OTR).',
              'Step 4: Fill the scholarship form with academic and institutional enrollment details.',
              'Step 5: Upload clear scanned copies of required documents.',
              'Step 6: Submit online and submit a copy to your college nodal officer for institutional verification.'
            ]).map(step => `
              <div class="checklist-item">
                <i class="fas fa-arrow-right" style="color:var(--orange)"></i>
                <div>${escapeHtml(step)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="detail-sidebar">
      <div class="sidebar-card">
        ${applicationUrl
          ? `<a class="apply-big-btn" href="${escapeHtml(applicationUrl)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square"></i> Apply Online Now</a>`
          : `<button class="apply-big-btn" style="cursor:default;opacity:0.7"><i class="fas fa-info-circle"></i> Official Portal</button>`}
        <p style="text-align:center;font-size:12px;color:var(--gray);margin-top:12px;">Direct verified gateway to the official portal</p>
      </div>

      <div class="sidebar-card">
        <h3>📋 Live Application Summary</h3>
        <div class="quick-info">
          <div class="qi-row">
            <span class="qi-label"><i class="fas fa-bolt"></i> Live Status</span>
            <span class="qi-value">${statusBadge}</span>
          </div>
          <div class="qi-row">
            <span class="qi-label"><i class="fas fa-gift"></i> Reward</span>
            <span class="qi-value">${escapeHtml(s.reward_amount_text || '—')}</span>
          </div>
          <div class="qi-row">
            <span class="qi-label"><i class="fas fa-calendar"></i> Deadline</span>
            <span class="qi-value">${formatLiveDate(s.close_date)}</span>
          </div>
          <div class="qi-row">
            <span class="qi-label"><i class="fas fa-wallet"></i> Application Fee</span>
            <span class="qi-value" style="color:#059669;font-weight:800;">₹0 (Free)</span>
          </div>
          <div class="qi-row">
            <span class="qi-label"><i class="fas fa-percent"></i> Min %</span>
            <span class="qi-value">${s.min_academic_percentage ? escapeHtml(s.min_academic_percentage) + '%' : 'Not specified'}</span>
          </div>
          <div class="qi-row">
            <span class="qi-label"><i class="fas fa-rupee-sign"></i> Max Income</span>
            <span class="qi-value">${s.max_family_income_inr && Number(s.max_family_income_inr) < 9999999 ? '₹' + Number(s.max_family_income_inr).toLocaleString('en-IN') : 'No limit'}</span>
          </div>
        </div>
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
    status.textContent = 'Opening your email app to send this message to blastedlimit@gmail.com.';
    window.location.href = mailto;
  });
  loadLandingStats();
  loadJobs();
  if (pendingResetToken) showAuthDialog('reset');
});