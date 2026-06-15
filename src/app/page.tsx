import RenderChat from "@/components/RenderChat";


export default function ChatPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-900 py-10">
      <h1 className="text-center font-bold text-2xl mb-2 text-gray-900 dark:text-white">
        Stream Engine
      </h1>
      <RenderChat wsUrl="ws://localhost:4747/ws" />
    </main>
  );
}
