
import React from 'react';

interface ApiKeyInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ApiKeyInstructionsModal: React.FC<ApiKeyInstructionsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) {
    return null;
  }

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const Step: React.FC<{ number: number; title: string; children: React.ReactNode }> = ({ number, title, children }) => (
    <div className="mb-6">
      <h3 className="text-xl font-bold text-brand-blue mb-2">Step {number}: {title}</h3>
      <div className="pl-4 border-l-2 border-brand-gray-700 space-y-2 text-brand-gray-300">
        {children}
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <style>{`
          @keyframes fade-in {
              from { opacity: 0; }
              to { opacity: 1; }
          }
          .animate-fade-in { animation: fade-in 0.2s ease-out; }
      `}</style>
      <div
        className="bg-brand-gray-800 rounded-lg shadow-2xl overflow-hidden w-full max-w-3xl border-2 border-brand-gray-700 mx-auto max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-brand-gray-700 flex-shrink-0">
          <h2 className="text-xl font-bold text-white">How to Get a Google API Key</h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-white/70 bg-black/40 rounded-full hover:text-white text-4xl leading-none font-light w-10 h-10 flex items-center justify-center">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto">
          <p className="mb-6 text-brand-gray-300">
            Follow these steps to create a Google API key and enable the necessary services for this application. Using Google Cloud may require a billing account.
          </p>
          
          <Step number={1} title="Go to the Google Cloud Console">
            <p>1. Open your web browser and navigate to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:underline">Google Cloud Console</a>.</p>
            <p>2. If you haven't used Google Cloud before, you may need to agree to the terms of service and set up a billing account.</p>
          </Step>

          <Step number={2} title="Create a New Project">
            <p>1. At the top of the page, click the project selector dropdown (it might say "Select a project").</p>
            <p>2. In the dialog that appears, click <strong>"NEW PROJECT"</strong>.</p>
            <p>3. Give your project a descriptive name, like "OSM Speed Auditor Project", and click <strong>"CREATE"</strong>.</p>
            <p>4. Wait for the project to be created, and make sure it is selected in the project selector dropdown.</p>
          </Step>

          <Step number={3} title="Enable the Required APIs">
            <p>You need to enable three specific APIs for this application to work.</p>
            <p>1. In the search bar at the top of the console, type <strong>"APIs & Services"</strong> and select it from the results.</p>
            <p>2. On the APIs & Services dashboard, click <strong>"+ ENABLE APIS AND SERVICES"</strong>.</p>
            <p>3. Search for and enable each of the following APIs one by one:</p>
            <ul className="list-disc list-inside pl-4 space-y-1">
              <li><strong>Street View Static API</strong></li>
              <li><strong>Maps Static API</strong></li>
              <li><strong>Vertex AI API</strong> (This is used for Gemini)</li>
            </ul>
          </Step>

          <Step number={4} title="Create the API Key">
            <p>1. From the APIs & Services page, go to the <strong>"Credentials"</strong> tab on the left-hand menu.</p>
            <p>2. Click <strong>"+ CREATE CREDENTIALS"</strong> at the top of the page and select <strong>"API key"</strong>.</p>
            <p>3. A new API key will be generated and displayed. Click the copy icon to copy it to your clipboard.</p>
          </Step>

          <Step number={5} title="Restrict Your API Key (Highly Recommended!)">
            <p>For security, you should restrict your key so it can only be used for the services you've enabled.</p>
            <p>1. In the "API key created" dialog, click <strong>"EDIT API KEY"</strong>. (If you closed it, just click on the key's name in the credentials list).</p>
            <p>2. Under <strong>"API restrictions"</strong>:</p>
            <ul className="list-disc list-inside pl-4 space-y-1">
              <li>Select the <strong>"Restrict key"</strong> option.</li>
              <li>Click the <strong>"Select APIs"</strong> dropdown.</li>
              <li>Check the boxes for the three APIs you enabled: <strong>Street View Static API</strong>, <strong>Maps Static API</strong>, and <strong>Vertex AI API</strong>.</li>
              <li>Click <strong>"OK"</strong>.</li>
            </ul>
            <p>3. Click <strong>"SAVE"</strong>.</p>
          </Step>
          
          <Step number={6} title="Use Your Key">
             <p>You can now paste the copied API key into the "Google API Key" field in the OSM Speed Auditor application.</p>
          </Step>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyInstructionsModal;
