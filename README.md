# TrackIt

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
   - Autotracking: con la herramienta *Auto* (`A`), haz clic sobre el objeto y se sigue solo desde ese fotograma. También puedes marcarlo y pulsar *Autotrack desde aquí*, que arranca en el último punto marcado. Busca en cada fotograma el recuadro de la plantilla que más se parece al de partida (correlación cruzada normalizada, con precisión de subpíxel). Si la coincidencia baja del umbral, se para: corrige a mano y vuelve a lanzarlo. Sobre el vídeo se ve la plantilla (recuadro sólido) y la zona de búsqueda del siguiente paso (discontinua, centrada donde se prevé el objeto según su velocidad); los dos se agrandan o encogen arrastrando sus esquinas. En el panel se ve la plantilla ampliada.
   - La búsqueda es piramidal (primero con la imagen reducida y luego refinando hasta la resolución original), así que plantillas y radios grandes no la frenan. Si la coincidencia baja del umbral, antes de pararse busca en una zona tres veces mayor, lo que la salva en los botes.
   - Para objetos rápidos y borrosos (una pelota que cae), activa *Plantilla evolutiva* y usa un radio de al menos la distancia que recorre entre fotogramas.
6. **Analiza.** La gráfica deja elegir cualquier variable frente a otra y ajustar una recta, parábola o cúbica (con su $R^2$, ver [Ajuste de curvas](#ajuste-de-curvas)). Clic en un punto de la gráfica o en una fila de la tabla lleva a ese fotograma.
7. **Exporta.** *Exportar CSV* saca todos los objetos (formato estándar o para Excel en español). *Guardar proyecto* guarda un `.trackit.json` con calibración, ejes y puntos para seguir otro día.

**Seguir otro día.** El análisis se autoguarda en el navegador: al volver a abrir el mismo vídeo (mismo nombre y tamaño) pregunta si quieres recuperarlo y salta al último fotograma marcado. Para cambiar de ordenador o de navegador, usa *Guardar proyecto* y luego *Abrir proyecto*, antes o después de abrir el vídeo.

## Cálculos

### Escala y posición

Un punto marcado tiene coordenadas de imagen $(u, v)$ en píxeles, con $v$ hacia abajo. La vara de calibración va de $(u_a, v_a)$ a $(u_b, v_b)$ y mide $L$ en la unidad elegida, así que la escala es

```math
k = \frac{L}{\sqrt{(u_b - u_a)^2 + (v_b - v_a)^2}}
```

(sin calibración, $k = 1$ y todo sale en píxeles). Con el origen de los ejes en $(u_0, v_0)$ y los ejes girados un ángulo $\theta$ (en sentido antihorario), la posición en el sistema de ejes, con $y$ hacia arriba, es

```math
\begin{aligned}
x &= k\,\big[(u - u_0)\cos\theta - (v - v_0)\sin\theta\big] \\
y &= k\,\big[-(u - u_0)\sin\theta - (v - v_0)\cos\theta\big]
\end{aligned}
```

### Tiempo

El fotograma $n$ corresponde al tiempo

```math
t_n = \frac{n - n_0}{f_r}
```

donde $n_0$ es el fotograma inicial del rango y $f_r$ son los *fps reales* (los de grabación, que en cámara lenta no coinciden con los del archivo).

### Velocidad y aceleración

Se calculan por **diferencias centradas**: cada punto usa a su vecino anterior y al siguiente. Con $h_1 = t_i - t_{i-1}$ y $h_2 = t_{i+1} - t_i$ (pueden ser distintos si hay huecos):

```math
v_{x,i} = \frac{x_{i+1} - x_{i-1}}{h_1 + h_2},
\qquad
a_{x,i} = \frac{2}{h_1 + h_2}\left(\frac{x_{i+1} - x_i}{h_2} - \frac{x_i - x_{i-1}}{h_1}\right)
```

y lo mismo para $y$. Con paso constante $h_1 = h_2 = \Delta t$ se reducen a las fórmulas habituales

```math
v_{x,i} = \frac{x_{i+1} - x_{i-1}}{2\,\Delta t},
\qquad
a_{x,i} = \frac{x_{i+1} - 2x_i + x_{i-1}}{\Delta t^2}
```

Los módulos son

```math
|v| = \sqrt{v_x^2 + v_y^2},
\qquad
|a| = \sqrt{a_x^2 + a_y^2}
```

El primer y el último punto no tienen velocidad ni aceleración, porque les falta un vecino.

### Autotracking

La plantilla $T$ es el recuadro de imagen (en escala de grises) alrededor del punto marcado. En cada posición candidata $(p, q)$ de la zona de búsqueda se compara con el recuadro $I$ del mismo tamaño mediante la **correlación cruzada normalizada**:

```math
r(p, q) = \frac{\sum_{j} \big(T_j - \bar T\big)\big(I_j - \bar I\big)}{\sqrt{\sum_{j} \big(T_j - \bar T\big)^2 \; \sum_{j} \big(I_j - \bar I\big)^2}}
```

donde la suma recorre los píxeles $j$ del recuadro y $\bar T$, $\bar I$ son sus valores medios. Vale $1$ si los dos recuadros son iguales salvo brillo y contraste, y es lo que se compara con el *umbral*. Se elige la posición con mayor $r$ y se afina por debajo del píxel ajustando una parábola a $r$ y sus dos vecinos en cada eje:

```math
\delta = \frac{r_{-1} - r_{+1}}{2\,\big(r_{-1} - 2r_0 + r_{+1}\big)}
```

La zona de búsqueda se centra donde estaría el objeto si siguiera a velocidad constante, $\hat{\mathbf p}_{n+1} = 2\,\mathbf p_n - \mathbf p_{n-1}$.

### Ajuste de curvas

El ajuste es por mínimos cuadrados: busca los coeficientes del polinomio $\hat y(x)$ que minimizan $\sum_i \big(y_i - \hat y(x_i)\big)^2$. La calidad se mide con el coeficiente de determinación

```math
R^2 = 1 - \frac{\sum_i \big(y_i - \hat y_i\big)^2}{\sum_i \big(y_i - \bar y\big)^2}
```

que vale $1$ si la curva pasa exactamente por todos los puntos. En un ajuste parabólico de la altura frente al tiempo, $y = A t^2 + B t + C$, la aceleración es $2A$: para una caída libre con el eje $y$ hacia arriba, $g = -2A$.

## Atajos

| Tecla | Acción |
|---|---|
| `←` `→` | Paso anterior / siguiente (`Mayús`: de 10 en 10) |
| `Inicio` `Fin` | Principio / final del rango |
| `Espacio` | Reproducir / pausar |
| `A` / `M` / `V` | Herramienta Auto / Marcar / Mover |
| `Supr` | Borrar el punto del fotograma actual |
| `Ctrl+Z` / `Ctrl+Y` | Deshacer / rehacer |
| Rueda | Zoom; arrastrar con botón derecho o central para desplazar |
| `F` | Ajustar el vídeo a la ventana |
| `Esc` | Detener el autotracking |

## Rendimiento

- El vídeo y las marcas van en dos lienzos superpuestos: pasar el ratón, arrastrar o marcar solo repinta las marcas.
- Todo el dibujo se agrupa en, como mucho, un repintado por refresco de pantalla; al reproducir se pinta solo cuando el vídeo presenta un fotograma nuevo (`requestVideoFrameCallback`).
- Filas de datos, gráfica y tabla se recalculan solo cuando cambian los datos. La gráfica guarda su base en caché y por fotograma solo mueve el punto actual.
- La tabla está virtualizada: solo existen en la página las filas visibles, así que pesa lo mismo con 300 puntos que con 30 000.
- El autoguardado se agrupa (como mucho cada 0,4 s) y el historial de deshacer guarda 100 pasos.

## Código

HTML, CSS y JavaScript sin dependencias ni compilación: `index.html`, `style.css` y `app.js`. Para publicarlo vale cualquier hosting estático (Vercel, GitHub Pages…).
