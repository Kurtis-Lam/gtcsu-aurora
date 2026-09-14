// Start fetching panel.html immediately upon script execution to remove round-trip network lag[cite: 4]
const panelFetchPromise = fetch('panel.html')
  .then(res => {
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return res.text();
  })
  .catch(err => {
    console.error('Error loading panel component:', err);
    return null;
  });

async function loadPanel() {
  const mountPoint = document.getElementById('panel-container');
  if (!mountPoint) return;

  const html = await panelFetchPromise;
  if (!html) return;

  mountPoint.innerHTML = html;

  // Active route matching[cite: 4]
  let currentPath = window.location.pathname.split('/').pop();
  if (!currentPath || currentPath === '') currentPath = 'index.html';

  const navLinks = mountPoint.querySelectorAll('.nav-links a');
  navLinks.forEach(link => {
    if (link.getAttribute('data-page') === currentPath) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Re-apply current language preferences[cite: 4]
  if (typeof setLanguage === 'function') {
    setLanguage(localStorage.getItem('aurora_lang') || 'en');
  }

  // Unified Mobile Hamburger Drawer Controls[cite: 4]
  const hamburger = mountPoint.querySelector('#hamburger-btn');
  const drawer = mountPoint.querySelector('#nav-links');
  const overlay = mountPoint.querySelector('#nav-overlay');

  function toggleMenu() {
    const isOpen = drawer.classList.toggle('active');
    if (hamburger) hamburger.classList.toggle('open', isOpen);
    if (overlay) overlay.classList.toggle('active', isOpen);
  }

  function closeMenu() {
    if (drawer) drawer.classList.remove('active');
    if (hamburger) hamburger.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
  }

  if (hamburger) hamburger.addEventListener('click', toggleMenu);
  if (overlay) overlay.addEventListener('click', closeMenu);
  navLinks.forEach(link => link.addEventListener('click', closeMenu));

  window.dispatchEvent(new Event('componentsLoaded'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadPanel);
} else {
  loadPanel();
}