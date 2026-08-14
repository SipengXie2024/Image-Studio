import { useStudioStore } from "../../state/studioStore";
import { RuleCurationModal } from "../../components/taste/RuleCurationModal";

export function RuleCurationGate() {
  const review = useStudioStore((state) => state.ruleCuration);
  const close = useStudioStore((state) => state.closeRuleCuration);
  const settingsOpen = useStudioStore((state) => state.settingsOpen);
  const upstreamModalOpen = useStudioStore((state) => state.upstreamModalOpen);
  const appUpdateModalOpen = useStudioStore((state) => state.appUpdateModalOpen);
  const tasteBootstrapOpen = useStudioStore((state) => state.tasteBootstrapOpen);

  if (!review || settingsOpen || upstreamModalOpen || appUpdateModalOpen || tasteBootstrapOpen) return null;

  return <RuleCurationModal onClose={close} />;
}
