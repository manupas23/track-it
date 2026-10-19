# TrackIt

Video analysis for physics in the browser, in the spirit of [Tracker](https://physlets.org/tracker/): calibrate the scale, place a set of axes, track objects frame by frame (by hand or automatically) and get positions, velocities, accelerations, plots with curve fitting and a CSV file.

Nothing to install and no server: the video is processed in your browser and never uploaded anywhere. The interface is available in English and Spanish (ES/EN switch in the top bar).

## Usage

Open `index.html` (or the published version) in Chrome, Edge or Firefox.

1. **Open a video** or drop it onto the page. MP4 (H.264) or WebM work best; `.avi` files or HEVC-encoded `.mov` files often fail in browsers and need converting first.
2. **Check the fps.** They are detected automatically. For slow-motion videos, enter the frame rate it was recorded at in *Real fps* (e.g. 240) so that times are correct.
3. **Calibrate.** Drag the ends of the blue stick onto something of known length and type its length and unit.
4. **Place the axes.** Drag the origin (yellow) and rotate the axes with the handle (hold `Shift` to snap to 15° steps).
5. **Track the object.**
   - Automatically: with the *Auto* tool (`A`), click on the object and it is followed from that frame on. You can also mark it and press *Autotrack from here*, which starts at the last marked point. In each frame it looks for the box that best matches the template (normalised cross-correlation, with sub-pixel precision). If the match drops below the threshold it stops: correct the point by hand and run it again.
   - The template (solid box) and the search area for the next step (dashed box, centred where the object is expected from its velocity) are drawn on the video; drag their corners to resize them. The panel shows an enlarged view of the template.
   - The search is pyramidal (first on a downscaled image, then refined up to full resolution), so large templates and search radii stay fast. Before stopping, it retries in an area three times larger, which keeps it on track through bounces.
   - For fast, blurry objects (a falling ball), turn on *Evolving template* and use a radius at least as large as the distance travelled between frames.
   - By hand: *Mark* tool (`M`) and click on the object; it moves on to the next step automatically. `Shift`+click marks with any tool.
6. **Analyse.** Plot any variable against another and fit a straight line, a parabola or a cubic (with its $R^2$, see [Curve fitting](#curve-fitting)). Click a point on the plot or a row of the table to jump to that frame.
7. **Export.** *Export CSV* writes all objects (standard format, or with `;` and a decimal comma for Excel in Spanish and other European locales). *Save project* saves a `.trackit.json` file with the calibration, axes and points so you can carry on later.

**Carrying on later.** Your analysis is saved automatically in the browser: when you open the same video again (same name and size) it offers to restore it and jumps to the last marked frame. To move to another computer or browser, use *Save project* and then *Open project*, before or after opening the video.

## Calculations

### Scale and position

A marked point has image coordinates $(u, v)$ in pixels, with $v$ pointing down. The calibration stick goes from $(u_a, v_a)$ to $(u_b, v_b)$ and is $L$ long in the chosen unit, so the scale is

```math
k = \frac{L}{\sqrt{(u_b - u_a)^2 + (v_b - v_a)^2}}
```

(without calibration, $k = 1$ and everything is in pixels). With the axes origin at $(u_0, v_0)$ and the axes rotated by an angle $\theta$ (counterclockwise), the position in the axes frame, with $y$ pointing up, is

```math
\begin{aligned}
x &= k\,\big[(u - u_0)\cos\theta - (v - v_0)\sin\theta\big] \\
y &= k\,\big[-(u - u_0)\sin\theta - (v - v_0)\cos\theta\big]
\end{aligned}
```

### Time

Frame $n$ corresponds to the time

```math
t_n = \frac{n - n_0}{f_r}
```

where $n_0$ is the first frame of the range and $f_r$ is the *real fps* (the recording frame rate, which differs from the file's in slow motion).

### Velocity and acceleration

They are computed with **centred differences**: each point uses its previous and next neighbours. With $h_1 = t_i - t_{i-1}$ and $h_2 = t_{i+1} - t_i$ (which may differ if there are gaps):

```math
v_{x,i} = \frac{x_{i+1} - x_{i-1}}{h_1 + h_2},
\qquad
a_{x,i} = \frac{2}{h_1 + h_2}\left(\frac{x_{i+1} - x_i}{h_2} - \frac{x_i - x_{i-1}}{h_1}\right)
```

and likewise for $y$. With a constant step $h_1 = h_2 = \Delta t$ they reduce to the usual formulas

```math
v_{x,i} = \frac{x_{i+1} - x_{i-1}}{2\,\Delta t},
\qquad
a_{x,i} = \frac{x_{i+1} - 2x_i + x_{i-1}}{\Delta t^2}
```

The magnitudes are

```math
|v| = \sqrt{v_x^2 + v_y^2},
\qquad
|a| = \sqrt{a_x^2 + a_y^2}
```

The first and last points have no velocity or acceleration, because they lack a neighbour.

### Autotracking

The template $T$ is the (greyscale) image box around the marked point. At each candidate position $(p, q)$ in the search area it is compared with the box $I$ of the same size using the **normalised cross-correlation**:

```math
r(p, q) = \frac{\sum_{j} \big(T_j - \bar T\big)\big(I_j - \bar I\big)}{\sqrt{\sum_{j} \big(T_j - \bar T\big)^2 \; \sum_{j} \big(I_j - \bar I\big)^2}}
```

where the sums run over the pixels $j$ of the box and $\bar T$, $\bar I$ are their mean values. It equals $1$ when both boxes are identical up to brightness and contrast, and it is what gets compared with the *threshold*. The position with the highest $r$ is chosen and refined below one pixel by fitting a parabola to $r$ and its two neighbours along each axis:

```math
\delta = \frac{r_{-1} - r_{+1}}{2\,\big(r_{-1} - 2r_0 + r_{+1}\big)}
```

The search area is centred where the object would be if it kept a constant velocity, $\hat{\mathbf p}_{n+1} = 2\,\mathbf p_n - \mathbf p_{n-1}$.

### Curve fitting

Fits use least squares: they find the coefficients of the polynomial $\hat y(x)$ that minimise $\sum_i \big(y_i - \hat y(x_i)\big)^2$. The quality of the fit is given by the coefficient of determination

```math
R^2 = 1 - \frac{\sum_i \big(y_i - \hat y_i\big)^2}{\sum_i \big(y_i - \bar y\big)^2}
```

which equals $1$ when the curve goes exactly through every point. In a quadratic fit of height against time, $y = A t^2 + B t + C$, the acceleration is $2A$: for free fall with the $y$ axis pointing up, $g = -2A$.

## Shortcuts

| Key | Action |
|---|---|
| `←` `→` | Previous / next step (`Shift`: 10 at a time) |
| `Home` `End` | Start / end of range |
| `Space` | Play / pause |
| `A` / `M` / `V` | Auto / Mark / Move tool |
| `Del` | Delete the point on the current frame |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| Wheel | Zoom; drag with the right or middle button to pan |
| `F` | Fit the video to the window |
| `Esc` | Stop autotracking |
