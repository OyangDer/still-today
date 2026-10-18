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

// The newest release's installer, so every download button is one click; the links fall back to the
// Releases page as written. "latest" never returns drafts or pre-releases.
fetch('https://api.github.com/repos/OyangDer/still-today/releases/latest')
  .then((r) => r.json())
  .then((release) => {
    const exe = release.assets.find((a) => a.name.endsWith('-setup.exe'));
    document.querySelectorAll('[data-download]').forEach((a) => (a.href = exe.browser_download_url));
    const meta = `${release.tag_name} · ${(exe.size / 1048576).toFixed(1)} MB · Windows 10 / 11`;
    document.querySelectorAll('[data-meta]').forEach((m) => (m.textContent = meta));
  });

// The newest Mac release's disk image. Mac releases are tagged mac-v… and never marked latest, so they
// are found in the list, newest first, skipping pre-releases (betas).
fetch('https://api.github.com/repos/OyangDer/still-today/releases?per_page=30')
  .then((r) => r.json())
  .then((releases) => {
    const release = releases.find((r) => r.tag_name.startsWith('mac-v') && !r.prerelease);
    const dmg = release?.assets.find((a) => a.name.endsWith('.dmg'));
    if (!dmg) return;
    document.querySelectorAll('[data-download-mac]').forEach((a) => (a.href = dmg.browser_download_url));
    const meta = `${release.tag_name.slice(4)} · ${(dmg.size / 1048576).toFixed(1)} MB · macOS 13+`;
    document.querySelectorAll('[data-meta-mac]').forEach((m) => (m.textContent = meta));
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
