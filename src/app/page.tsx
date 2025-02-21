import ClientMap from '../components/ClientMap';

export default function Home() {
  return (
    <div className="flex flex-col h-screen">
      <header className="p-2 bg-gray-900">
        <div className="p-2">
          <h1 className="text-xl font-bold text-gray-100">Generate AOI</h1>
        </div>
      </header>
      <main className="flex flex-1 min-h-0">
        <ClientMap />
      </main>
      <footer className="p-1 text-xs bg-gray-900 text-gray-100 text-center">
        MGRS Coordinate Mapper, RTAMS
      </footer>
    </div>
  );
}
