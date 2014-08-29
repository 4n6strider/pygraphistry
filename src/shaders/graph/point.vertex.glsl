precision mediump float;

#define W_VAL 1.0
#define Z_VAL 0.0

uniform mat4 mvp;
attribute vec2 curPos;

attribute float pointSize;

attribute vec4 pointColor;
varying vec4 vColor;

void main(void) {
    gl_PointSize = clamp(pointSize, 0.125, 10.0);

    vec4 pos = vec4(curPos.x, 1.0 * curPos.y, Z_VAL, W_VAL);
    gl_Position = mvp * pos;

    vColor = pointColor;
}