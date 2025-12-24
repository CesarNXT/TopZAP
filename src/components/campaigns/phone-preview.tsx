'use client';

import { Image as ImageIcon, Video, Music, FileText } from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface PhonePreviewProps {
  message: string;
  media: File | null;
  buttons?: { id: string; text: string }[];
}

export const PhonePreview: React.FC<PhonePreviewProps> = ({ message, media, buttons = [] }) => {
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);

  useEffect(() => {
    if (media) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setMediaPreview(reader.result as string);
      };
      reader.readAsDataURL(media);
      setMediaType(media.type);
    } else {
      setMediaPreview(null);
      setMediaType(null);
    }
  }, [media]);

  const renderMediaPreview = () => {
    if (!mediaPreview || !mediaType) return null;

    if (mediaType.startsWith('image/')) {
      return <img src={mediaPreview} alt="Preview" className="w-full h-auto rounded-lg" />;
    }
    if (mediaType.startsWith('video/')) {
      return (
        <div className="bg-black rounded-lg flex items-center justify-center aspect-video">
          <Video className="w-10 h-10 text-white" />
        </div>
      );
    }
     if (mediaType.startsWith('audio/')) {
      return (
        <div className="bg-gray-200 p-3 rounded-lg flex items-center gap-2">
            <Music className="w-6 h-6 text-gray-600" />
            <span className="text-sm text-gray-700">{media?.name}</span>
        </div>
      );
    }
    if (mediaType === 'application/pdf') {
       return (
        <div className="bg-gray-200 p-3 rounded-lg flex items-center gap-2">
            <FileText className="w-6 h-6 text-red-600" />
            <span className="text-sm text-gray-700">{media?.name}</span>
        </div>
      );
    }
    return null;
  };

  const formattedMessage = message
    .replace(/\[Nome\]/g, 'Ana')
    .split('\n')
    .map((line, index) => (
      <React.Fragment key={index}>
        {line}
        <br />
      </React.Fragment>
    ));

  return (
    <div className="w-full max-w-[300px] mx-auto bg-white dark:bg-slate-900 border-[10px] border-black rounded-[40px] shadow-2xl overflow-hidden">
      <div className="h-[550px] bg-gray-100 dark:bg-gray-800 overflow-y-auto">
        <div className="p-4 flex flex-col space-y-2">
            {/* No default greeting preview */}

            {/* User's message preview */}
             <div className="flex justify-end w-full">
                <div className="bg-[#dcf8c6] dark:bg-[#005c4b] rounded-lg rounded-tr-none p-2 max-w-[90%] shadow-sm text-black dark:text-white">
                    {mediaPreview && (
                        <div className="mb-2">
                            {renderMediaPreview()}
                        </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{formattedMessage}</p>
                    
                    {/* Simulated Footer */}
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2 border-t border-gray-300 dark:border-gray-600 pt-1">
                        Privacidade
                    </p>

                    {/* Simulated Buttons */}
                    <div className="mt-2 -mx-2 -mb-2 flex flex-col">
                        {buttons.map((btn, idx) => (
                             <div key={btn.id} className="bg-white dark:bg-[#232d36] border-t border-gray-200 dark:border-gray-700 p-2.5 text-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                <span className="text-[#00a884] dark:text-[#53bdeb] text-sm font-medium">{btn.text}</span>
                            </div>
                        ))}
                        <div className={`bg-white dark:bg-[#232d36] border-t border-gray-200 dark:border-gray-700 p-2.5 text-center cursor-pointer ${buttons.length === 0 ? 'rounded-b-lg' : 'rounded-b-lg'} hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}>
                            <span className="text-[#00a884] dark:text-[#53bdeb] text-sm font-medium">Bloquear Contato</span>
                        </div>
                    </div>

                    <div className="flex justify-end items-center gap-1 mt-1">
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">10:30</span>
                        {/* Double check icon simulated */}
                        <svg viewBox="0 0 16 11" width="16" height="11" className="text-[#53bdeb]">
                            <path fill="currentColor" d="M11.4004 0.428571L10.3719 1.45714L12.9148 4H0V5.42857H12.9148L10.3719 7.97143L11.4004 9L15.6861 4.71429L11.4004 0.428571Z" transform="scale(0.6)"/>
                            <path fill="currentColor" d="M10.9719 0.428571L9.94336 1.45714L12.4862 4H5.14286V5.42857H12.4862L9.94336 7.97143L10.9719 9L15.2576 4.71429L10.9719 0.428571Z" transform="translate(4, 0) scale(0.6)"/>
                        </svg>
                    </div>
                </div>
            </div>
        </div>
      </div>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-4 bg-black rounded-b-lg"></div>
    </div>
  );
};
