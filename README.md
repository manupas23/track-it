# Track-it

Videoanálisis para física en el navegador, al estilo de [Tracker](https://physlets.org/tracker/): calibras la escala, colocas unos ejes, sigues objetos fotograma a fotograma (a mano o con autotracking) y obtienes posiciones, velocidades, aceleraciones, gráficas con ajuste de curvas y un CSV.

No hace falta instalar nada ni hay servidor: el vídeo se procesa en tu navegador y no se sube a ningún sitio.

## Uso

Abre `index.html` (o la versión publicada) en Chrome, Edge o Firefox.

1. **Abre un vídeo** o arrástralo. Mejor MP4 (H.264) o WebM; los `.avi` o `.mov` HEVC suelen dar error en el navegador y hay que convertirlos antes.
2. **Revisa los fps.** Se detectan solos. Si el vídeo es a cámara lenta, pon en *fps reales* los fps a los que se grabó (p. ej. 240) para que los tiempos sean los de verdad.
3. **Calibra.** Arrastra los extremos de la vara azul sobre algo de longitud conocida y escribe su longitud y unidad.
4. **Coloca los ejes.** Arrastra el origen (amarillo) y gíralos con el asa (con `Mayús`, de 15° en 15°).
5. **Sigue el objeto.**
   - A mano: herramienta *Marcar* (`M`) y clic sobre el objeto; avanza solo al siguiente paso. `Mayús`+clic marca con cualquier herramienta.
   - Autotracking: márcalo en un fotograma y pulsa *Autotrack desde aquí*. Busca en cada fotograma el recuadro de la plantilla que más se parece al de partida (correlación cruzada normalizada, con precisión de subpíxel). Si la coincidencia baja del umbral, se para: corrige a mano y vuelve a lanzarlo. Sobre el vídeo se ve la plantilla (recuadro sólido) y la zona de búsqueda del siguiente paso (discontinua, centrada donde se prevé el objeto según su velocidad); los dos se agrandan o encogen arrastrando sus esquinas. En el panel se ve la plantilla ampliada.
   - La búsqueda es piramidal (primero con la imagen reducida y luego refinando hasta la resolución original), así que plantillas y radios grandes no la frenan. Si la coincidencia baja del umbral, antes de pararse busca en una zona tres veces mayor, lo que la salva en los botes.
   - Para objetos rápidos y borrosos (una pelota que cae), activa *Plantilla evolutiva* y usa un radio de al menos la distancia que recorre entre fotogramas.
6. **Analiza.** La gráfica deja elegir cualquier variable frente a otra y ajustar una recta, parábola o cúbica (con `R²`). Clic en un punto de la gráfica o en una fila de la tabla lleva a ese fotograma.
7. **Exporta.** *Exportar CSV* saca todos los objetos (formato estándar o para Excel en español). *Guardar proyecto* guarda un `.trackit.json` con calibración, ejes y puntos para seguir otro día.

**Seguir otro día.** El análisis se autoguarda en el navegador: al volver a abrir el mismo vídeo (mismo nombre y tamaño) pregunta si quieres recuperarlo y salta al último fotograma marcado. Para cambiar de ordenador o de navegador, usa *Guardar proyecto* y luego *Abrir proyecto*, antes o después de abrir el vídeo.

## Cálculos

- Posición en el sistema de ejes: se traslada al origen, se gira el ángulo de los ejes, el eje y apunta hacia arriba y se multiplica por la escala `longitud de la vara / longitud en píxeles`.
- `t = (fotograma − fotograma inicial) / fps reales`.
- Velocidad y aceleración por diferencias centradas entre puntos vecinos (admite pasos desiguales):

  ```
  v_i = (x_{i+1} − x_{i−1}) / (t_{i+1} − t_{i−1})

          2 ⎛ x_{i+1} − x_i     x_i − x_{i−1} ⎞
  a_i = ─── ⎜ ───────────── − ───────────── ⎟ ,   h₁ = t_i − t_{i−1},  h₂ = t_{i+1} − t_i
        h₁+h₂ ⎝      h₂               h₁      ⎠
  ```

  El primer y el último punto no tienen velocidad ni aceleración.

## Atajos

| Tecla | Acción |
|---|---|
| `←` `→` | Paso anterior / siguiente (`Mayús`: de 10 en 10) |
| `Inicio` `Fin` | Principio / final del rango |
| `Espacio` | Reproducir / pausar |
| `M` / `V` | Herramienta Marcar / Mover |
| `Supr` | Borrar el punto del fotograma actual |
| `Ctrl+Z` / `Ctrl+Y` | Deshacer / rehacer |
| Rueda | Zoom; arrastrar con botón derecho o central para desplazar |
| `F` | Ajustar el vídeo a la ventana |
| `Esc` | Detener el autotracking |

## Código

HTML, CSS y JavaScript sin dependencias ni compilación: `index.html`, `style.css` y `app.js`. Para publicarlo vale cualquier hosting estático (Vercel, GitHub Pages…).
