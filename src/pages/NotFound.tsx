/**
 * NotFound Page — Simple 404 page.
 * Uses CSS animations instead of framer-motion.
 */

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col animate-[fadeIn_0.5s_ease-out]">
      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-5xl mx-auto relative px-4">
          <div className="flex items-center justify-center min-h-[200px]">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-gray-900 mb-4">404</h1>
              <p className="text-lg text-gray-600">Page Not Found</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
