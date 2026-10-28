import { PresentationView } from "@/components/presentation/presentation-view";

export default async function PresentationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PresentationView deckId={id} />;
}
