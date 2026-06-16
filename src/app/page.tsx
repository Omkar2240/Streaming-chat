import RenderChat from "@/components/RenderChat";


export default function ChatPage() {
  return (
    <main className="h-screen bg-white dark:bg-gray-900">
      <RenderChat wsUrl="ws://localhost:4747/ws" />
    </main>
  );
}
