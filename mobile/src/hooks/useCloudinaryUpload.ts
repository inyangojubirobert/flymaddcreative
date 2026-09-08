import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';

export type UploadProgress = {
  loaded: number;
  total: number;
};

export type CloudinaryUploadResponse = {
  public_id: string;
  url: string;
  secure_url: string;
  resource_type: string;
  width?: number;
  height?: number;
  size: number;
};

type UseCloudinaryUploadState = {
  loading: boolean;
  error: string | null;
  progress: UploadProgress | null;
};

export function useCloudinaryUpload() {
  const [state, setState] = useState<UseCloudinaryUploadState>({
    loading: false,
    error: null,
    progress: null,
  });

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        return result.assets[0];
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: `Image picker error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  };

  const uploadToCloudinary = async (imageUri: string): Promise<CloudinaryUploadResponse | null> => {
    if (!process.env.EXPO_PUBLIC_CLOUDINARY_NAME || !process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET) {
      setState(prev => ({
        ...prev,
        error: 'Cloudinary configuration missing',
      }));
      return null;
    }

    setState(prev => ({
      ...prev,
      loading: true,
      error: null,
      progress: { loaded: 0, total: 100 },
    }));

    try {
      // Read the image file
      const formData = new FormData();
      
      // Extract filename from URI
      const filename = imageUri.split('/').pop() || `image_${Date.now()}.jpg`;
      
      formData.append('file', {
        uri: imageUri,
        type: 'image/jpeg',
        name: filename,
      } as any);

      formData.append('upload_preset', process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET);

      const uploadUrl = `https://api.cloudinary.com/v1_1/${process.env.EXPO_PUBLIC_CLOUDINARY_NAME}/image/upload`;

      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100;
          setState(prev => ({
            ...prev,
            progress: { loaded: event.loaded, total: event.total },
          }));
        }
      });

      return await new Promise((resolve, reject) => {
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText) as CloudinaryUploadResponse;
            setState(prev => ({
              ...prev,
              loading: false,
              progress: null,
            }));
            resolve(response);
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.open('POST', uploadUrl);
        xhr.send(formData);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
        progress: null,
      }));
      return null;
    }
  };

  const uploadImage = async (): Promise<CloudinaryUploadResponse | null> => {
    const image = await pickImage();
    if (image && image.uri) {
      return uploadToCloudinary(image.uri);
    }
    return null;
  };

  return {
    ...state,
    uploadImage,
    uploadToCloudinary,
    pickImage,
  };
}
