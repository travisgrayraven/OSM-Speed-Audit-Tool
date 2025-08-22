
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-brand-gray-800 p-4 shadow-md">
      <div className="container mx-auto flex items-center">
        <h1 className="text-2xl font-bold text-white tracking-tight">OSM Speed Auditor</h1>
      </div>
    </header>
  );
};

export default Header;
