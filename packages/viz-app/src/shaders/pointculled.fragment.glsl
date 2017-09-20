precision highp float;

varying vec4 vColor;
varying float strokeRatio;

void main(void) {
    float radius = length(gl_PointCoord * 2.0 - vec2(1.0));
    float alpha = smoothstep(1.0, 0.95, radius) * step(strokeRatio, radius);
    gl_FragColor = vec4(vColor.xyz, vColor.w * alpha);
}
