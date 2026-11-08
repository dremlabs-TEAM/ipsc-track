# IPSC Track

Aplicación web de entrenamiento para tiro práctico: análisis de postura con IA, entrenamiento en seco con escenarios dinámicos, shot timer e historial de progreso. Funciona en el navegador (PC o móvil), sin instalación y sin cuentas.

**▶ Abrir la app:** https://dremlabs-team.github.io/ipsc-track/

## Funciones

- **Cámara en directo:** detección del cuerpo con IA y puntuación de consistencia de 9 métricas (hombros, codos, rodillas, inclinación de cabeza, distancia cabeza‑muñecas, posición del arma, apertura y escalonado de pies, torso). Esqueleto coloreado en verde, amarillo o rojo según tu referencia personal.
- **Calibración personal:** guarda tu mejor postura como referencia; las puntuaciones miden tu desviación respecto a ella.
- **En seco (Arena):** escenarios IPSC generados al azar. Suena el beep, aparece la dirección y, al desplazarte de verdad hacia ese lado, cambia el escenario. Incluye poppers que activan móviles (balancín, drop turner, deslizante y emergente).
- **Vídeo:** análisis de grabaciones, fotograma a fotograma, con comparación lado a lado y exportación de la comparativa.
- **Historial y comparación** de sesiones, con gráfico de evolución.
- **Shot timer:** beep con retardo aleatorio, par time y detección de disparos por micrófono.

## Privacidad

- La imagen de la cámara y el sonido del micrófono se procesan **en tu propio dispositivo**. No se envían a ningún servidor.
- El perfil, las referencias y el historial se guardan **solo en el navegador** de cada usuario (`localStorage`). Cada miembro del equipo tiene sus propios datos.
- Para pasar los datos a otro dispositivo, usa *Historial → Exportar copia* e *Importar*.

## Requisitos

- Un navegador actual (Chrome, Edge, Safari o Firefox) con permiso de cámara (y de micrófono para el timer).
- Conexión a internet la primera vez, para descargar el modelo de detección de pose (MediaPipe).

## Ejecutar en local

```bash
python server.py 8080
```

Después abre http://localhost:8080. En Windows también puedes usar `iniciar.bat`.

## Seguridad

El entrenamiento en seco se hace **siempre con el arma descargada y sin munición en la sala**. Respeta las normas de seguridad de tu club y de tu federación.

## Créditos y aviso

- Detección de pose: [MediaPipe Pose Landmarker](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker) (Google).
- Las medidas de la diana IPSC, los poppers y las placas siguen el reglamento IPSC Handgun 2024 (Apéndices B2, C2 y C3).
- Proyecto independiente, sin afiliación ni respaldo de la International Practical Shooting Confederation (IPSC) ni de ninguna federación. «IPSC» es una marca de sus respectivos titulares.

© 2026 dremlabs. Todos los derechos reservados.
