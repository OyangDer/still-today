// A Mac visitor (marked in <head>, before anything loads) gets the Mac download first, the header's
// button included, and sees the Mac widget in every picture; a Windows visitor keeps the Windows one,
// which has no glass. The Mac pictures are a different size, so the Windows one's is dropped.
if (document.documentElement.classList.contains('mac')) {
  document.querySelectorAll('.nav-dl').forEach((a) => (a.removeAttribute('data-download'), a.setAttribute('data-download-mac', '')));
  document.querySelectorAll('img[data-mac]').forEach((img) => {
    img.removeAttribute('width');
    img.removeAttribute('height');
    img.src = img.dataset.mac;
  });
}

// The newest installer for each system, so every download button is one click; the links fall back to
// the Releases page as written. A release carries one installer or both (Windows and Mac share one
// since Mac 0.2.4) and is tagged either way, so each is found by its file, newest release first,
// skipping pre-releases (betas; drafts never show here), and its version is read from the file name.
fetch('https://api.github.com/repos/OyangDer/still-today/releases?per_page=30')
  .then((r) => r.json())
  .then((releases) => {
    const files = releases.filter((r) => !r.prerelease).flatMap((r) => r.assets);
    const offer = (pattern, links, metas, system) => {
      const file = files.find((a) => pattern.test(a.name));
      if (!file) return;
      const version = file.name.match(/\d+\.\d+\.\d+/)[0];
      document.querySelectorAll(links).forEach((a) => (a.href = file.browser_download_url));
      const meta = `v${version} · ${(file.size / 1048576).toFixed(1)} MB · ${system}`;
      document.querySelectorAll(metas).forEach((m) => (m.textContent = meta));
    };
    offer(/-setup\.exe$/, '[data-download]', '[data-meta]', 'Windows 10 / 11');
    offer(/\.dmg$/, '[data-download-mac]', '[data-meta-mac]', 'macOS 13+');
  });

document.querySelectorAll('[data-copy]').forEach((b) =>
  b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(location.origin + location.pathname);
    b.textContent = b.dataset.copied;
  }),
);

const header = document.querySelector('header');
addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 8), { passive: true });

const seen = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), seen.unobserve(e.target))),
  { rootMargin: '0px 0px -8% 0px' },
);
document.querySelectorAll('.reveal').forEach((el) => seen.observe(el));
