# Museo Virtual

Plataforma web de museos y galerías virtuales para artistas, en producción en [museo.wailus.co](https://museo.wailus.co). Combina museos 3D recorribles en primera persona con galerías de lienzo infinito, catálogos interactivos y estadísticas de visitas, todo construido con JavaScript vanilla y Three.js, sin frameworks.

## Las artistas

El proyecto aloja el trabajo de dos artistas independientes:

- **Danní** (@paintsbydani) — 31 obras repartidas en un museo 3D de dos salas y una galería de lienzo. Cada obra enlaza a su publicación original de Instagram.
- **Catalina Olivero** (@catalinaoliveroart) — dos colecciones: *Rumiaciones* (2026, acrílico sobre lienzo sin imprimar) y *Conexiones* (2022 – presente). Cada colección tiene su propio museo 3D, galería de lienzo y catálogo con fichas de venta.

Cada artista tiene además una página privada de estadísticas de visitas, independiente de la otra.

## Páginas

| Ruta | Contenido |
|---|---|
| `/` | Museo 3D de Danní (dos salas conectadas por puertas) |
| `/playground.html` | Galería de lienzo infinito de Danní |
| `/catalina.html` | Entrada de Catalina: redirige al museo de Rumiaciones; con `?entrar` abre la galería de lienzo de Rumiaciones |
| `/conexiones.html` | Galería de lienzo de Conexiones |
| `/museo.html` | Museo 3D de Conexiones |
| `/museo-rumiaciones.html` | Museo 3D de Rumiaciones (bilingüe español/inglés) |
| `/stats.html`, `/stats-danni.html`, `/stats-catalina.html` | Estadísticas de visitas (global y por artista) |

## Funcionalidades

### Museos 3D

- Recorrido en primera persona: WASD y mouse con pointer lock en escritorio; joystick virtual, arrastre de cámara y giroscopio en móvil (tracking independiente por dedo).
- Recorrido automático cinematográfico con dolly-in por obra, barra de tiempo y controles de navegación.
- Salas generadas por código a partir de la lista de obras: el tamaño de la sala, la distribución en las paredes, los focos y las lámparas se calculan según el número de piezas.
- Dos estilos de sala sobre el mismo motor: clásico (piso de nogal, luz cálida, zócalo) y minimal tipo *white cube* (estuco blanco, concreto pulido con reflejo, shadow gap, lámparas LED de superficie, sombras bajo las obras).
- Placas por obra con título, técnica, medidas y precio, con jerarquía tipográfica y filtrado anisotrópico para lectura en ángulo.
- Panel de obra al acercarse, con zoom (rueda, pinch, arrastre y doble toque) y enlace a Instagram.
- Modo "luces apagadas" (tecla L) con paleta e iluminación alternativas.
- Vitrina central clickeable que abre el catálogo (flipbook 3D con paso de página, ficha por obra y descarga de PDF cuando existe).
- Museo de Rumiaciones bilingüe: interfaz, statement, títulos de obra y medidas (cm/pulgadas) en español e inglés, con la elección recordada por navegador.
- Pantalla de instrucciones (máximo dos veces por dispositivo) y gestos animados de ayuda en móvil.
- Contador de obras vistas ("5 de 12 obras vistas") para incentivar el recorrido completo.

### Galerías de lienzo infinito

- Lienzo arrastrable e infinito en las cuatro direcciones con virtualización de nodos (pool reciclable) para mantener 60 fps.
- Zoom con rueda y pinch, inercia, efecto tilt 3D en hover, parallax de fondo y control por giroscopio.
- Modal de obra con zoom, navegación entre obras, enlaces directos por hash (`#id-de-obra`) y sonidos procedurales generados con Web Audio (sin archivos de audio).
- Tema claro/oscuro persistente y biografía de artista en español e inglés.

### Infraestructura y robustez

- Contador de visitas propio del lado del servidor (Node sin dependencias, datos fuera del repo), con desglose por página y por día; excluye navegadores automatizados y dispositivos de desarrollo (`?soydev`).
- Optimización agresiva para móvil: texturas de pared en 820 px, pixel ratio limitado, audio con carga diferida, modelo de banca comprimido, imágenes WebP en tres tamaños.
- Manejo de fallos visibles: si WebGL no arranca o el dispositivo se queda sin memoria gráfica se muestra un mensaje con botón de recarga en lugar de una página en blanco; `?debug` activa una consola de errores en pantalla para diagnóstico en teléfonos.
- Caché correcto en nginx: HTML siempre revalidado, assets con hash cacheados 30 días; los archivos de imagen se renombran cuando cambia su contenido.

## Cómo fue hecho

El proyecto es una aplicación multipágina de Vite con JavaScript vanilla (módulos ES). No usa React ni ningún framework de UI: el DOM se maneja directamente y el 3D con Three.js.

Las salas 3D no son modelos descargados sino geometría construida en código (`src/museo/sala.js`): un motor genérico `buildSalaPremium(config)` recibe la lista de obras y las opciones de estilo y levanta paredes, piso, lucernario, focos por obra, placas, vinilos de texto, vitrina, puertas y bancas. Las texturas combinan tres fuentes: canvas 2D procedural (pisos de madera y concreto de respaldo, placas, vinilos con auto-ajuste de fuente, oclusión ambiental horneada), fotografías propias procesadas con sharp (concreto pulido y estuco) y materiales PBR de bibliotecas libres (yeso de Poliigon con mapas de normales y rugosidad, activos solo en escritorio).

El movimiento en primera persona es un motor propio (`src/engine/engine.js`): pointer lock, colisiones por cajas, gravedad, head-bob, animaciones de cámara para el zoom a obra y soporte de joystick virtual. Se renderiza directo (sin post-procesado) para que las obras usen `toneMapped: false` y conserven el color exacto de la fotografía.

La galería de lienzo (`src/playground/gallery.js`) es un motor 2D reutilizable que las tres galerías inicializan con su configuración. El catálogo (`src/playground/flipbook.js`) es un flipbook CSS 3D generado desde los mismos datos.

Los datos de cada artista viven en módulos planos (`src/data/*.js`): una entrada por obra con archivo de imagen, proporción real, título, técnica, precio y enlace. Añadir una obra es agregar una entrada y correr el pipeline de imágenes.

## Especificaciones técnicas

### Dependencias

| Paquete | Versión | Uso |
|---|---|---|
| three | 0.182 | Renderizado 3D (WebGL), GLTFLoader, RectAreaLight, Reflector |
| vanilla-tilt | 1.8.1 | Efecto tilt en las tarjetas de la galería (solo dispositivos con hover) |
| vite | 7.2 | Bundler y servidor de desarrollo, build multipágina |

Herramientas usadas fuera del bundle (no son dependencias de producción): sharp para el pipeline de imágenes (WebP en tres tamaños, recortes y ajustes), @gltf-transform/cli para comprimir el modelo GLB de la banca y qrcode para generar códigos QR.

### Requisitos

- Node.js 18 o superior (desarrollado con Node 24).
- Navegador con WebGL. En móvil se degradan automáticamente texturas, pixel ratio y efectos.

### Producción

- VPS Ubuntu con nginx sirviendo el build estático (`dist/`) con gzip.
- Contador de visitas: proceso Node propio (sin dependencias) gestionado con pm2 detrás de `location /api/`, con escritura debounced a un JSON fuera del repo para sobrevivir deploys.
- Deploy: `git pull && npm run build` en el servidor.

### Parámetros de URL útiles

| Parámetro | Efecto |
|---|---|
| `?entrar` | Entra directo a la sala o galería, saltando la portada |
| `?lang=en` / `?lang=es` | Idioma del museo de Rumiaciones (se recuerda) |
| `?soydev` | Marca el navegador para que sus visitas no cuenten en estadísticas |
| `?debug` | Consola de errores visible en pantalla (diagnóstico móvil) |
| `#id-de-obra` | En las galerías, abre directamente esa obra |

## Estructura del repositorio

```
├── index.html                  Museo 3D de Danní
├── museo.html                  Museo 3D de Conexiones
├── museo-rumiaciones.html      Museo 3D de Rumiaciones (ES/EN)
├── playground.html             Galería de Danní
├── catalina.html               Galería de Rumiaciones + selector de colecciones
├── conexiones.html             Galería de Conexiones
├── public/
│   ├── posts/ cat-posts/ conexiones-posts/    Imágenes de obra (original + thumb + full en WebP)
│   ├── texturas/               Texturas fotográficas de la sala minimal
│   ├── models/                 Banca GLB
│   ├── stats*.html             Páginas de estadísticas
│   └── docs/                   Catálogos en PDF
├── src/
│   ├── engine/engine.js        Motor de primera persona (cámara, colisiones, input)
│   ├── museo/sala.js           Generador de salas (clásica y minimal)
│   ├── museo/usabilidad.js     Zoom de panel, giroscopio, fades, manejo de errores
│   ├── museo/{museo,rumiaciones}.js  Lógica de cada museo
│   ├── main.js                 Lógica del museo de Danní
│   ├── playground/gallery.js   Motor de galería de lienzo infinito
│   ├── playground/flipbook.js  Catálogo flipbook 3D
│   ├── data/                   Datos de obras por artista
│   └── misc/                   Utilidades (visitas, helpers)
├── server/contador.js          Microservicio de conteo de visitas
└── scripts/gen-webp.mjs        Pipeline de optimización de imágenes
```

## Desarrollo local

```bash
npm install
npm run dev       # servidor de desarrollo
npm run build     # build de producción en dist/
npm run preview   # sirve el build localmente
```

---

Desarrollado por Stiven Antequera. Obras y textos son propiedad de sus respectivas artistas.
