/** @type {import('tailwindcss').Config} */
export default {
	content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				// Custom palette
				'powder-blush': '#ffa69e',
				'vanilla-cream': '#faf3dd',
				'icy-aqua': '#b8f2e6',
				'light-blue': '#aed9e0',
				'blue-slate': '#5e6472',
				immich: {
					primary: '#5e6472', // Blue Slate
					'primary-dark': '#4a5058',
					'primary-light': '#aed9e0', // Light Blue
					dark: {
						bg: '#0a0a0a',
						card: '#141414',
						surface: '#1a1a1a',
					},
				},
			},
			fontFamily: {
				sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
			},
			borderRadius: {
				'2xl': '1rem',
				'3xl': '1.5rem',
			},
			animation: {
				'spin-slow': 'spin 2s linear infinite',
			},
		},
	},
	plugins: [],
};
