import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../icons";

type Toast = {
	id: number;
	message: string;
	tone: "info" | "error";
	action?: { label: string; run: () => void };
};
type ToastApi = {
	show: (
		message: string,
		options?: { tone?: Toast["tone"]; action?: Toast["action"] },
	) => void;
};

const Ctx = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const counter = useRef(0);
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	const dismiss = useCallback(
		(id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
		[],
	);
	const show = useCallback<ToastApi["show"]>(
		(message, options) => {
			const id = ++counter.current;
			setToasts((t) => [
				...t.slice(-3),
				{ id, message, tone: options?.tone ?? "info", action: options?.action },
			]);
			setTimeout(() => dismiss(id), options?.tone === "error" ? 6000 : 4000);
		},
		[dismiss],
	);

	return (
		<Ctx.Provider value={{ show }}>
			{children}
			{mounted &&
				createPortal(
					<div
						className="pointer-events-none fixed bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 z-[70] flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col gap-2 max-md:bottom-[calc(84px+env(safe-area-inset-bottom))]"
						aria-live="polite"
					>
						{toasts.map((toast) => (
							<output
								key={toast.id}
								className={`pointer-events-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm shadow-pop ${toast.tone === "error" ? "bg-coral text-paper" : "bg-ink text-paper"}`}
							>
								<span>{toast.message}</span>
								{toast.action && (
									<button
										type="button"
										className="font-medium underline"
										onClick={() => {
											toast.action?.run();
											dismiss(toast.id);
										}}
									>
										{toast.action.label}
									</button>
								)}
								<button
									type="button"
									aria-label="Dismiss"
									className="opacity-60 hover:opacity-100 coarse:-m-2 coarse:flex coarse:size-10 coarse:items-center coarse:justify-center"
									onClick={() => dismiss(toast.id)}
								>
									<CloseIcon size={12} />
								</button>
							</output>
						))}
					</div>,
					document.body,
				)}
		</Ctx.Provider>
	);
}
