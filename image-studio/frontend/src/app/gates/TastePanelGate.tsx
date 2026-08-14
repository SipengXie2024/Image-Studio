import { useStudioStore } from "../../state/studioStore";
import { TastePanel } from "../../components/taste/TastePanel";

export function TastePanelGate() {
  const open = useStudioStore((state) => state.tastePanelOpen);
  const close = useStudioStore((state) => state.closeTastePanel);
  const settingsOpen = useStudioStore((state) => state.settingsOpen);
  const upstreamModalOpen = useStudioStore((state) => state.upstreamModalOpen);
  const appUpdateModalOpen = useStudioStore((state) => state.appUpdateModalOpen);
  const tasteBootstrapOpen = useStudioStore((state) => state.tasteBootstrapOpen);

  if (!open || settingsOpen || upstreamModalOpen || appUpdateModalOpen || tasteBootstrapOpen) return null;

  return <TastePanel onClose={close} />;
}
