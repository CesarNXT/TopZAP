'use client';

import { Image as ImageIcon, Video, Music, FileText } from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface PhonePreviewProps {
  message: string;
  media: File | null;
}

export const PhonePreview: React.FC<PhonePreviewProps> = ({ message, media }) => {
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
    <div className="w-full max-w-[300px] mx-auto bg-white border-[10px] border-black rounded-[40px] shadow-2xl overflow-hidden">
      <div className="h-[550px] bg-gray-100 dark:bg-gray-800 overflow-y-auto">
        <div className="p-4 flex flex-col space-y-2">
            {/* Fake received message */}
            <div className="flex justify-start">
                <div className="bg-white dark:bg-gray-700 rounded-lg rounded-bl-none p-2 max-w-[80%]">
                    <p className="text-sm text-gray-800 dark:text-gray-200">Olá! 😊</p>
                </div>
            </div>

            {/* User's message preview */}
             <div className="flex justify-end">
                <div className="bg-primary/90 rounded-lg rounded-br-none p-2 max-w-[80%] text-white">
                    {mediaPreview && (
                        <div className="mb-2">
                            {renderMediaPreview()}
                        </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{formattedMessage}</p>
                    <p className="text-right text-xs text-green-100/70 mt-1">10:30 AM</p>
                </div>
            </div>
        </div>
      </div>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-4 bg-black rounded-b-lg"></div>
    </div>
  );
};
