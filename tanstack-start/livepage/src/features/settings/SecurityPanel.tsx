import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Skeleton, Switch, useToast } from "#/components/ui";
import { TwoStepSettings } from "#/features/auth/TwoStepSettings";
import { timeAgo } from "#/features/workspace/format";
import {
	fetchDevices,
	fetchFeatures,
	submitFlag,
	submitSignOutDevice,
	submitSignOutOthers,
} from "#/functions/settings";
import { errorText } from "#/lib/errors";
import { Group, PanelTitle, Row, TextLink } from "./ui";

type Device = Awaited<ReturnType<typeof fetchDevices>>[number];

// Appwrite can't always tell the browser for sessions made through the site's server.
function describe(device: Device) {
	const known =
		device.clientName !== "Unknown browser" && device.clientName !== "Unknown";
	if (known)
		return `${device.clientName} on ${device.deviceModel || device.osName}`;
	return device.current ? "This browser" : "Another browser";
}

export function SecurityPanel() {
	const { workspace } = useWorkspace();
	const toast = useToast();
	const [devices, setDevices] = useState<Device[] | null>(null);
	const [required, setRequired] = useState<boolean | null>(null);
	const [canChange, setCanChange] = useState(false);

	const loadDevices = useCallback(() => {
		fetchDevices()
			.then(setDevices)
			.catch((err) => toast.show(errorText(err), { tone: "error" }));
	}, [toast]);

	useEffect(loadDevices, [loadDevices]);

	useEffect(() => {
		fetchFeatures({ data: { workspaceId: workspace.id } })
			.then((f) => {
				setRequired(f.flags.requireTwoStep);
				setCanChange(f.canChange);
			})
			.catch(() => setRequired(null));
	}, [workspace.id]);

	const toggleRequired = async (value: boolean) => {
		const before = required;
		setRequired(value);
		try {
			await submitFlag({ data: { name: "requireTwoStep", value } });
		} catch (err) {
			setRequired(before);
			toast.show(errorText(err), { tone: "error" });
		}
	};

	const signOut = async (id: string) => {
		setDevices((list) => list?.filter((d) => d.id !== id) ?? list);
		try {
			await submitSignOutDevice({ data: { sessionId: id } });
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			loadDevices();
		}
	};

	const signOutOthers = async () => {
		try {
			await submitSignOutOthers();
			loadDevices();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		}
	};

	return (
		<>
			<PanelTitle title="Security" />
			<Group title="Your account">
				<div className="pt-3">
					<TwoStepSettings />
				</div>
			</Group>
			{required !== null && canChange && (
				<Group title="Workspace">
					<Row
						title="Require two-step sign-in for everyone"
						detail="Members without it are asked to set it up next time they sign in."
					>
						<Switch
							checked={required}
							onChange={(v) => void toggleRequired(v)}
							label="Require two-step sign-in for everyone"
						/>
					</Row>
				</Group>
			)}
			<Group
				title="Active sessions"
				action={
					devices && devices.length > 1 ? (
						<TextLink onClick={() => void signOutOthers()}>
							Sign out everywhere else
						</TextLink>
					) : undefined
				}
			>
				{!devices ? (
					<div className="flex flex-col gap-2 pt-2">
						<Skeleton className="h-10" />
						<Skeleton className="h-10" />
					</div>
				) : (
					devices.map((device) => (
						<Row
							key={device.id}
							title={describe(device)}
							detail={
								device.countryName && device.countryName !== "Unknown"
									? device.countryName
									: undefined
							}
						>
							{device.current ? (
								<span className="text-sm text-green">This device</span>
							) : (
								<div className="flex items-center gap-6">
									<span className="text-sm text-graphite">
										{timeAgo(device.updatedAt)}
									</span>
									<TextLink onClick={() => void signOut(device.id)}>
										Sign out
									</TextLink>
								</div>
							)}
						</Row>
					))
				)}
			</Group>
		</>
	);
}
