export function Spinner({
	size = 16,
	label = "Loading",
}: {
	size?: number;
	label?: string;
}) {
	return (
		<svg
			aria-label={label}
			width={size}
			height={size}
			viewBox="0 0 16 16"
			className="animate-spin"
			style={{ flexShrink: 0 }}
		>
			<circle
				cx="8"
				cy="8"
				r="6"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				opacity="0.25"
			/>
			<path
				d="M8 2a6 6 0 0 1 6 6"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	);
}
