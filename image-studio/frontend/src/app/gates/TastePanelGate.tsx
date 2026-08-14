import { useStudioStore } from "../../state/studioStore";
import { TastePanel } from "../../components/taste/TastePanel";

export function TastePanelGate() {
  const open = useStudioStore((state) => state.tastePanelOpen);
  const close = useStudioStore((state) => state.closeTastePanel);
  const settingsOpen = useStudioStore((state) => state.settingsOpen);
  const upstreamModalOpen = useStudioStore((state) => state.upstreamModalOpen);
  const appUpdateModalOpen = useStudioStore((state) => state.appUpdateModalOpen);
  const tasteBootstrapOpen = useStudioStore((state) => state.tasteBootstrapOpen);
  const ruleCuration = useStudioStore((state) => state.ruleCuration);

  if (!open || settingsOpen || upstreamModalOpen || appUpdateModalOpen || tasteBootstrapOpen || ruleCuration) return null;

  return <TastePanel onClose={close} />;
}
