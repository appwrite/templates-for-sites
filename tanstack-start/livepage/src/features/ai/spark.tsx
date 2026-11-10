// The AI mark from the boards. Takes the text color, so it can be cobalt, amber or gray.
export function Spark({ size = 14 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 14 14"
			aria-hidden="true"
			style={{ flexShrink: 0 }}
		>
			<path
				d="M7 1.5 8.3 5.7 12.5 7 8.3 8.3 7 12.5 5.7 8.3 1.5 7l4.2-1.3z"
				fill="currentColor"
			/>
		</svg>
	);
}
