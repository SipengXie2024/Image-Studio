import { useStudioStore } from "../../state/studioStore";
import { TasteBootstrapModal } from "../../components/taste/TasteBootstrapModal";

export function TasteBootstrapGate() {
  const open = useStudioStore((state) => state.tasteBootstrapOpen);
  const profile = useStudioStore((state) => state.tasteProfile);
  const loading = useStudioStore((state) => state.tasteLoading);
  const decide = useStudioStore((state) => state.decideTasteCandidate);
  const acknowledge = useStudioStore((state) => state.acknowledgeTasteBootstrap);
  const close = useStudioStore((state) => state.closeTasteBootstrap);
  const settingsOpen = useStudioStore((state) => state.settingsOpen);
  const upstreamModalOpen = useStudioStore((state) => state.upstreamModalOpen);
  const appUpdateModalOpen = useStudioStore((state) => state.appUpdateModalOpen);

  if (!open || settingsOpen || upstreamModalOpen || appUpdateModalOpen) return null;

  return (
    <TasteBootstrapModal
      profile={profile}
      loading={loading}
      onDecide={decide}
      onAcknowledge={acknowledge}
      onClose={close}
    />
  );
}
