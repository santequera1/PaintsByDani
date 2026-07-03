import { ARTIST } from './catalina.js'

export { ARTIST }

export const COLLECTION = {
  name: 'Conexiones',
  year: '2022 – Presente',
  // Declaración de artista (del catálogo de la expo)
  statement:
    'Mi práctica artística se centra en la saturación informativa de la cultura digital y la manera en que esta configura las relaciones interpersonales en el mundo actual. A través de capas de acrílico y sutiles relieves, he desarrollado un lenguaje visual que traduce el flujo constante de datos en estructuras gráficas que evocan estados de sobrecarga cognitiva.',
  // Versión completa (para el catálogo/flipbook)
  statementFull: [
    'Mi práctica artística se centra en la saturación informativa de la cultura digital y la manera en que esta configura las relaciones interpersonales en el mundo actual. A través de capas de acrílico y sutiles relieves, he desarrollado un lenguaje visual que traduce el flujo constante de datos en estructuras gráficas que evocan estados de sobrecarga cognitiva, donde la acumulación física de la pintura contrasta con la bidimensionalidad de las interfaces digitales y simula una experiencia tanto tangible como virtual.',
    'Las piezas funcionan como ventanas al presente que invitan al espectador a confrontar el consumo de información impuesto en nuestra vida cotidiana. En ellas observamos un mapa visual que cuestiona cómo interactuamos en entornos mediatizados, donde los algoritmos influyen cada vez más en nuestra percepción de la realidad. Al hacer uso de la abstracción y el símbolo, mi trabajo no solo busca evidenciar la dispersión de la atención contemporánea, sino también abrir espacios de contemplación, propiciando una observación más consciente de los sistemas que nos rigen. En última instancia, busco plantear una visión crítica de cómo la tecnología nos influye y lo que dice de nosotros como especie.',
  ],
  pdfUrl: '/docs/EXPO-CONEXIONES-2026.pdf',
}

// Datos del PDF "EXPO CONEXIONES 2026" (título, técnica, medidas, precio)
export const ARTWORKS = [
  {
    id: 'pelicanos',
    filename: 'La Desaparición de los Pelícanos, 2023.png',
    title: 'La Desaparición de los Pelícanos, 2023',
    medium: 'Acrílico sobre lienzo · 70 × 100 cm',
    price: 'No disponible',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'narices-frias',
    filename: 'La Noche de las Narices Frías, 2022.jpg',
    title: 'La Noche de las Narices Frías, 2022',
    medium: 'Acrílico sobre lienzo · 90 × 120 cm',
    price: 'No disponible',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'maniaco',
    filename: 'Maníaco, 2022.jpg',
    title: 'Maníaco, 2022',
    medium: 'Acrílico sobre lienzo · 60 × 90 cm',
    price: '1.500.000 COP',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'oceano',
    filename: 'Océano, 2022.jpg',
    title: 'Océano, 2022',
    medium: 'Óleo sobre lienzo · 60 × 90 cm',
    price: '1.000.000 COP', // corregido por Catalina vía IG (el PDF decía 1.500.000)
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'colonizacion-x',
    filename: 'Colonización de X, 2023.jpg',
    title: 'Colonización de X, 2023',
    medium: 'Acrílico sobre lienzo · 60 × 90 cm',
    price: '2.000.000 COP',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'vainilla-chocolate',
    filename: 'Vainilla y Chocolate, 2025.jpg',
    title: 'Vainilla y Chocolate, 2025',
    medium: 'Acrílico y pasta de modelar sobre lienzo · 70 × 100 cm',
    price: '2.000.000 COP',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'claudel-rodin',
    filename: 'Claudel y Rodin, 2025.jpg',
    title: 'Claudel y Rodin, 2025',
    medium: 'Acrílico y pasta de modelar sobre lienzo · 90 × 120 cm',
    price: '2.800.000 COP',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'cest-la-vie',
    filename: "C'est la vie, 2023.jpg",
    title: "C'est la vie, 2023",
    medium: 'Acrílico sobre lienzo · 70 × 100 cm',
    price: '2.000.000 COP',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'oui-oui-baguette',
    filename: 'Oui Oui Baguette, 2022.webp',
    title: 'Oui Oui Baguette, 2022',
    medium: '',
    price: '',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'yes-no',
    filename: 'Yes-No, 2022.png',
    title: 'Yes/No, 2022',
    medium: 'Acrílico sobre lienzo · 30 × 40 cm',
    price: '200.000 COP',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'aron-piper',
    filename: 'Aron Piper, 2022.jpg',
    title: 'Aron Piper, 2022',
    medium: 'Acrílico sobre lienzo · 30 × 40 cm',
    price: '200.000 COP',
    instagramUrl: ARTIST.instagramUrl,
  },
  {
    id: 'peut-etre',
    filename: 'Peut être, 2022.png',
    title: 'Peut être, 2022',
    medium: 'Acrílico sobre lienzo · 30 × 40 cm',
    price: '200.000 COP',
    instagramUrl: ARTIST.instagramUrl,
  },
]
