import {
	BackSide,
	BoxGeometry,
	Mesh,
	ShaderMaterial,
	UniformsUtils,
	Vector3
} from 'three';

/**
 * Based on "A Practical Analytic Model for Daylight"
 * aka The Preetham Model, the de facto standard analytic skydome model
 * https://www.researchgate.net/publication/220720443_A_Practical_Analytic_Model_for_Daylight
 *
 * First implemented by Simon Wallner
 * http://simonwallner.at/project/atmospheric-scattering/
 *
 * Improved by Martin Upitis
 * http://blenderartists.org/forum/showthread.php?245954-preethams-sky-impementation-HDR
 *
 * Three.js integration by zz85 http://twitter.com/blurspline
*/

class Sky extends Mesh {

	constructor() {

		const shader = Sky.SkyShader;

		const material = new ShaderMaterial( {
			name: shader.name,
			uniforms: UniformsUtils.clone( shader.uniforms ),
			vertexShader: shader.vertexShader,
			fragmentShader: shader.fragmentShader,
			side: BackSide,
			depthWrite: false
		} );

		super( new BoxGeometry( 1, 1, 1 ), material );

		this.isSky = true;

	}

}

Sky.SkyShader = {

	name: 'SkyShader',

	uniforms: {
		'turbidity': { value: 2 },
		'rayleigh': { value: 1 },
		'mieCoefficient': { value: 0.005 },
		'mieDirectionalG': { value: 0.8 },
		'sunPosition': { value: new Vector3() },
		'up': { value: new Vector3( 0, 1, 0 ) },
		// PATCHED, deviating from upstream three.js on purpose (the only
		// file in js/vendor touched this way besides BokehShader.js,
		// which documents the same kind of targeted fix) — turbidity/
		// rayleigh/mieCoefficient only ever scale the RATIO between the
		// Rayleigh (blue) and Mie (white/hazy) scattering terms; none of
		// them touch the shader's own absolute output magnitude, which
		// is dominated by hardcoded constants baked directly into the
		// GLSL source (EE = 1000.0, and a further *19000.0 on the sun
		// disc term) that were never exposed as uniforms. At any sun
		// elevation low enough to rake light in sideways through a
		// window — exactly what this room's own key light does — the
		// near-horizon band this room's narrow openings actually reveal
		// sits deep enough into that hardcoded HDR range that swinging
		// turbidity/rayleigh/mieCoefficient across their entire sane
		// range (confirmed directly: 2/1/0.005 vs 6/3/0.005 produced
		// near-IDENTICAL output) still tonemaps down to the same flat,
		// desaturated near-white — ACES compresses a wide range of
		// "very bright" inputs toward the same ~1.0 ceiling. skyExposure
		// is a real linear scalar on the shader's own final HDR colour,
		// applied before tonemapping, giving independent control over
		// brightness instead of only the Rayleigh/Mie colour ratio
		'skyExposure': { value: 1 },
		// PATCHED, same reasoning as skyExposure above. This shader's
		// own colour comes from two terms — the coloured Rayleigh/Mie
		// in-scattering (Lin) and a flat, colourless "night sky" term
		// (L0 = vec3(0.1)*Fex) — and confirmed directly (by sampling
		// actual rendered pixels while sweeping turbidity/rayleigh/
		// mieCoefficient across their whole sane range): for a camera
		// ray that's level or pitched slightly DOWN, direction.y clamps
		// to exactly the 90-degree-horizon case in this shader's own
		// zenith-angle math (the longest possible optical path, by
		// design — real horizons are the haziest part of any sky), and
		// at that specific angle L0's flat, achromatic contribution
		// dominates enough that the result reads as near-neutral grey
		// REGARDLESS of the Rayleigh/Mie colour ratio. This colour is
		// where the actual visible warmth of a hazy real-world horizon
		// comes from instead — the shader's own physically-neutral
		// grey isn't wrong, it's just not what a real photographed
		// horizon (which always has some colour, warm near the sun,
		// cooler away from it) looks like once genuinely exposed down
		// to a sane brightness
		'uHorizonTint': { value: new Vector3(0.87, 0.8, 0.68) },
		'uHorizonTintStrength': { value: 0.55 },
	},

	vertexShader: /* glsl */`
		uniform vec3 sunPosition;
		uniform float rayleigh;
		uniform float turbidity;
		uniform float mieCoefficient;
		uniform vec3 up;

		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		// constants for atmospheric scattering
		const float e = 2.71828182845904523536028747135266249775724709369995957;
		const float pi = 3.141592653589793238462643383279502884197169;

		// wavelength of used primaries, according to preetham
		const vec3 lambda = vec3( 680E-9, 550E-9, 450E-9 );
		// this pre-calcuation replaces older TotalRayleigh(vec3 lambda) function:
		// (8.0 * pow(pi, 3.0) * pow(pow(n, 2.0) - 1.0, 2.0) * (6.0 + 3.0 * pn)) / (3.0 * N * pow(lambda, vec3(4.0)) * (6.0 - 7.0 * pn))
		const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );

		// mie stuff
		// K coefficient for the primaries
		const float v = 4.0;
		const vec3 K = vec3( 0.686, 0.678, 0.666 );
		// MieConst = pi * pow( ( 2.0 * pi ) / lambda, vec3( v - 2.0 ) ) * K
		const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );

		// earth shadow hack
		// cutoffAngle = pi / 1.95;
		const float cutoffAngle = 1.6110731556870734;
		const float steepness = 1.5;
		const float EE = 1000.0;

		float sunIntensity( float zenithAngleCos ) {
			zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
			return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
		}

		vec3 totalMie( float T ) {
			float c = ( 0.2 * T ) * 10E-18;
			return 0.434 * c * MieConst;
		}

		void main() {

			vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
			vWorldPosition = worldPosition.xyz;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			gl_Position.z = gl_Position.w; // set z to camera.far

			vSunDirection = normalize( sunPosition );

			vSunE = sunIntensity( dot( vSunDirection, up ) );

			vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );

			float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );

			// extinction (absorbtion + out scattering)
			// rayleigh coefficients
			vBetaR = totalRayleigh * rayleighCoefficient;

			// mie coefficients
			vBetaM = totalMie( turbidity ) * mieCoefficient;

		}`,

	fragmentShader: /* glsl */`
		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		uniform float mieDirectionalG;
		uniform vec3 up;
		uniform float skyExposure;
		uniform vec3 uHorizonTint;
		uniform float uHorizonTintStrength;

		// constants for atmospheric scattering
		const float pi = 3.141592653589793238462643383279502884197169;

		const float n = 1.0003; // refractive index of air
		const float N = 2.545E25; // number of molecules per unit volume for air at 288.15K and 1013mb (sea level -45 celsius)

		// optical length at zenith for molecules
		const float rayleighZenithLength = 8.4E3;
		const float mieZenithLength = 1.25E3;
		// 66 arc seconds -> degrees, and the cosine of that
		const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;

		// 3.0 / ( 16.0 * pi )
		const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
		// 1.0 / ( 4.0 * pi )
		const float ONE_OVER_FOURPI = 0.07957747154594767;

		float rayleighPhase( float cosTheta ) {
			return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) );
		}

		float hgPhase( float cosTheta, float g ) {
			float g2 = pow( g, 2.0 );
			float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
			return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
		}

		void main() {

			vec3 direction = normalize( vWorldPosition - cameraPosition );

			// optical length
			// cutoff angle at 90 to avoid singularity in next formula.
			float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );
			float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
			float sR = rayleighZenithLength * inverse;
			float sM = mieZenithLength * inverse;

			// combined extinction factor
			vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );

			// in scattering
			float cosTheta = dot( direction, vSunDirection );

			float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
			vec3 betaRTheta = vBetaR * rPhase;

			float mPhase = hgPhase( cosTheta, mieDirectionalG );
			vec3 betaMTheta = vBetaM * mPhase;

			vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
			Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - dot( up, vSunDirection ), 5.0 ), 0.0, 1.0 ) );

			// nightsky
			float theta = acos( direction.y ); // elevation --> y-axis, [-pi/2, pi/2]
			float phi = atan( direction.z, direction.x ); // azimuth --> x-axis [-pi/2, pi/2]
			vec2 uv = vec2( phi, theta ) / vec2( 2.0 * pi, pi ) + vec2( 0.5, 0.0 );
			vec3 L0 = vec3( 0.1 ) * Fex;

			// a literal bright solar disc used to sit here (upstream's own
			// sundisk term — a hard, razor-thin 66-arcsecond circle
			// multiplied by 19000) and was removed outright per an earlier
			// direct request to keep the sun off-camera. GOLDEN-SUNSET PASS
			// (per direct request): re-added now, deliberately NOT as that
			// same hard disc — a smoothstep-thresholded circle at that
			// scale reads as a harsh, single-pixel-edge aliased dot, which
			// is presumably why it read badly before. sunGlow below is a
			// broad, gradual pow() falloff around the sun's own bearing
			// instead — a soft warm glow with no hard edge to alias — and
			// it's given its own dedicated brightness constant kept
			// independent of skyExposure (the general sky-brightness dial),
			// so the sun's own visible size/warmth stays stable even if
			// the rest of the sky's exposure is retuned later. The rest of
			// the atmospheric scattering above (Lin, still driven by
			// vSunE/cosTheta) is untouched — that's the soft directional
			// glow/warmth concentrated toward the sun's own bearing that
			// was already here
			// exponent kept deliberately low (broad, forgiving glow, roughly
			// a 10-15° soft radius) rather than a tight pinprick — this
			// room's camera framing is fixed per stage with no guarantee
			// any one of them looks EXACTLY at the sun's precise bearing,
			// so a glow this size is what actually reads as "there's a
			// visible sun over there" through a real window opening
			// instead of needing pixel-perfect alignment to ever appear
			float sunGlow = pow( max( cosTheta, 0.0 ), 40.0 );
			vec3 sunGlowColor = sunGlow * vec3( 1.0, 0.78, 0.5 ) * 5.0;

			// a real visible sun body (per direct request: "I would like to
			// see an actual real sun on the left side where the windows are
			// at") — sunGlow above is deliberately a broad, soft, edge-less
			// warmth (see its own comment on why the razor-thin upstream
			// sundisk was removed); this is a SEPARATE, smoothstep-thresholded
			// circle layered on top of it, at a real but forgiving apparent
			// size (~4° radius) with a genuinely soft (not aliased) edge, so
			// it reads as an actual sun body sitting inside that glow rather
			// than the glow alone standing in for one
			float sunDisc = smoothstep( 0.9975, 0.9995, cosTheta );
			vec3 sunDiscColor = sunDisc * vec3( 1.0, 0.94, 0.82 ) * 9.0;

			vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );

			vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );

			// see uHorizonTint's own comment above — real colour for the
			// near-horizon band, strongest right at direction.y == 0.0
			// (a level sightline, exactly what this room's own window/
			// arch openings give a standing-height camera).
			// GREY-SKY DIAGNOSIS FIX (per direct request): falloff widened
			// (0.52→1.0 rad, ~30°→~57°) — this room's window openings are
			// tall enough that a large share of the sky patch actually
			// visible through them sat OUTSIDE the old, narrower band,
			// showing the Preetham shader's own flat, colourless "night
			// sky" term (L0 below) untouched — literally grey by
			// definition, not merely untinted. Widening this is what
			// actually lets the warm tint reach as high as what's really
			// visible, instead of only colouring a thin strip at the very
			// bottom of each opening
			float horizonness = 1.0 - smoothstep( 0.0, 1.0, abs( direction.y ) );
			vec3 tintedColor = mix( retColor, retColor * uHorizonTint * 1.6, horizonness * uHorizonTintStrength );

			gl_FragColor = vec4( tintedColor * skyExposure + sunGlowColor + sunDiscColor, 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`

};

export { Sky };
