async function loadPanel() {
  const mountPoint = document.getElementById('panel-container');
  if (!mountPoint) return;

  try {
    const response = await fetch('panel.html');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const html = await response.text();
    mountPoint.innerHTML = html;

    let currentPath = window.location.pathname.split('/').pop();
    if (!currentPath || currentPath === '') currentPath = 'index.html';

    const navLinks = mountPoint.querySelectorAll('.nav-links a');
    navLinks.forEach(link => {
      if (link.getAttribute('data-page') === currentPath) link.classList.add('active');
      else link.classList.remove('active');
    });

    if (typeof setLanguage === 'function') setLanguage(localStorage.getItem('aurora_lang') || 'en');

    // Sidebar drawer toggle functionality
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

    // Close sidebar when clicking any navigation link
    navLinks.forEach(link => link.addEventListener('click', closeMenu));

  } catch (err) {
    console.error('Error loading component panel:', err);
  } finally {
    // Tell the main page it is safe to remove the preloader and play the video
    window.dispatchEvent(new Event('componentsLoaded'));
  }
}

document.addEventListener('DOMContentLoaded', loadPanel);