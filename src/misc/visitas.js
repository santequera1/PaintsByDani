// Registra una visita por página y por sesión de pestaña (sessionStorage
// evita contar cada recarga). Falla en silencio si no hay red/endpoint.
export function contarVisita(pagina) {
  try {
    const key = 'visita-' + pagina
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    fetch('/api/visita?p=' + encodeURIComponent(pagina), { method: 'POST', keepalive: true }).catch(() => {})
  } catch { /* sin contador si el navegador lo bloquea */ }
}
