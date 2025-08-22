
import React from 'react';

interface StatusLogProps {
  logs: string[];
}

const StatusLog: React.FC<StatusLogProps> = ({ logs }) => {
  const logContainerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-brand-gray-900 border border-brand-gray-700 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
      <div ref={logContainerRef} className="h-full">
        {logs.map((log, index) => (
          <p key={index} className="text-brand-gray-400 whitespace-pre-wrap">
            <span className="text-brand-blue mr-2">{`>`}</span>{log}
          </p>
        ))}
      </div>
    </div>
  );
};

export default StatusLog;