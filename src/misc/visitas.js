// Registra una visita por página y por sesión de pestaña (sessionStorage
// evita contar cada recarga). Falla en silencio si no hay red/endpoint.
//
// Exclusiones:
// - navigator.webdriver: navegadores automatizados (capturas de verificación,
//   bots) no cuentan.
// - Modo desarrollador: entrar UNA vez con ?soydev en la URL marca el
//   navegador de forma permanente y ninguna visita futura cuenta desde él.
export function contarVisita(pagina) {
  try {
    if (navigator.webdriver) return
    const qs = new URLSearchParams(location.search)
    if (qs.has('soydev')) {
      try { localStorage.setItem('dev-no-contar', '1') } catch {}
      console.info('[visitas] modo desarrollador activado: este navegador ya no cuenta')
    }
    if (localStorage.getItem('dev-no-contar') === '1') return
    const key = 'visita-' + pagina
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    fetch('/api/visita?p=' + encodeURIComponent(pagina), { method: 'POST', keepalive: true }).catch(() => {})
  } catch { /* sin contador si el navegador lo bloquea */ }
}
