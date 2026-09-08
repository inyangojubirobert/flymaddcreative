import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
} from 'react-native';
import { useColorScheme } from '../hooks/use-color-scheme';
import { useCloudinaryUpload } from '../hooks/useCloudinaryUpload';
import { sendMessage, getConversation, Message } from '../api/messages-p2p';
import { Palette } from '../constants/theme';

type MessageScreenProps = {
  receiverId: string;
  token: string;
  currentUserId: string;
  onBack?: () => void;
};

const MessageScreen: React.FC<MessageScreenProps> = ({
  receiverId,
  token,
  currentUserId,
  onBack,
}) => {
  const colorScheme = useColorScheme();
  const { width: screenWidth } = useWindowDimensions();
  const isDark = colorScheme === 'dark';
  const listRef = useRef<FlatList<Message> | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [textInput, setTextInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);

  const { uploadImage, loading: uploading, error: uploadError } = useCloudinaryUpload();

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getConversation(token, receiverId);
      setMessages(data);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoading(false);
    }
  }, [receiverId, token]);

  // Load conversation on mount and when either participant changes.
  useEffect(() => {
    const loadTimer = setTimeout(() => void loadMessages(), 0);
    return () => clearTimeout(loadTimer);
  }, [loadMessages]);

  const handleImagePick = async () => {
    try {
      const result = await uploadImage();
      if (result) {
        setSelectedImages(prev => [...prev, result.secure_url]);
      }
    } catch (error) {
      console.error('Image upload failed:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!textInput.trim() && selectedImages.length === 0) return;

    try {
      setSending(true);
      const message = await sendMessage(token, {
        receiver_id: receiverId,
        content: textInput,
        media_urls: selectedImages.length > 0 ? selectedImages : undefined,
      });

      setMessages(prev => [...prev, message]);
      setTextInput('');
      setSelectedImages([]);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isCurrentUser = item.sender_id === currentUserId;
    return (
      <View
        style={[
          styles.messageContainer,
          isCurrentUser ? styles.sentMessage : styles.receivedMessage,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            isCurrentUser
              ? { backgroundColor: Palette.blue }
              : { backgroundColor: isDark ? '#334155' : Palette.ashSoft },
          ]}
        >
          {item.media_urls && item.media_urls.length > 0 && (
            <View style={styles.mediaContainer}>
              {item.media_urls.map((url, index) => (
                <Image
                  key={`${item.id}-${index}`}
                  source={{ uri: url }}
                  style={[styles.messageImage, { maxWidth: screenWidth * 0.6 }]}
                />
              ))}
            </View>
          )}
          {item.content && (
            <Text
              style={[
                styles.messageText,
                {
                  color: isCurrentUser ? '#FFF' : isDark ? '#FFF' : '#000',
                },
              ]}
            >
              {item.content}
            </Text>
          )}
        </View>
        <Text
          style={[
            styles.timestamp,
            { color: isDark ? '#999' : '#666' },
          ]}
        >
          {new Date(item.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    );
  };

  const renderSelectedImage = (uri: string, index: number) => (
    <View key={index} style={styles.selectedImageWrapper}>
      <Image source={{ uri }} style={styles.selectedImage} />
      <TouchableOpacity
        style={styles.removeImageButton}
        onPress={() => setSelectedImages(prev => prev.filter((_, i) => i !== index))}
      >
        <Text style={styles.removeImageText}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#FFF' }]}>
      {/* Messages List */}
      {loading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.messageListFlex}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.messagesList}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          nestedScrollEnabled
          scrollEnabled
          overScrollMode="always"
          showsVerticalScrollIndicator
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Input Area */}
      <View style={[styles.inputArea, { borderTopColor: isDark ? '#333' : '#E5E5EA' }]}>
        {/* Selected Images Preview */}
        {selectedImages.length > 0 && (
          <ScrollView horizontal style={styles.imagePreviewScroll}>
            {selectedImages.map((uri, index) => renderSelectedImage(uri, index))}
          </ScrollView>
        )}

        {/* Upload Error */}
        {uploadError && (
          <Text style={[styles.errorText, { color: '#FF3B30' }]}>{uploadError}</Text>
        )}

        {/* Input Row */}
        <View style={styles.inputRow}>
          {/* Image Button */}
          <TouchableOpacity
            style={[styles.actionButton, { opacity: uploading ? 0.5 : 1 }]}
            onPress={handleImagePick}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Text style={styles.actionButtonText}>📷</Text>
            )}
          </TouchableOpacity>

          {/* Text Input */}
          <TextInput
            style={[
              styles.textInput,
              {
                color: isDark ? '#FFF' : '#000',
                borderColor: isDark ? '#333' : '#E5E5EA',
                backgroundColor: isDark ? '#1C1C1C' : '#F5F5F5',
              },
            ]}
            placeholder="Type a message..."
            placeholderTextColor={isDark ? '#999' : '#666'}
            value={textInput}
            onChangeText={setTextInput}
            multiline
          />

          {/* Send Button */}
          <TouchableOpacity
            style={[
              styles.sendButton,
              {
                opacity: sending || (!textInput.trim() && selectedImages.length === 0) ? 0.5 : 1,
              },
            ]}
            onPress={handleSendMessage}
            disabled={sending || (!textInput.trim() && selectedImages.length === 0)}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Text style={styles.sendButtonText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  messageListFlex: { flex: 1 },
  messageContainer: {
    marginVertical: 8,
    flexDirection: 'column',
  },
  sentMessage: {
    alignItems: 'flex-end',
  },
  receivedMessage: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '84%',
    shadowColor: Palette.slateDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 7,
    elevation: 2,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  mediaContainer: {
    marginBottom: 8,
  },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: 8,
    marginBottom: 4,
  },
  timestamp: {
    fontSize: 12,
    marginTop: 4,
  },
  inputArea: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: Palette.ashSoft,
  },
  imagePreviewScroll: {
    marginBottom: 8,
  },
  selectedImageWrapper: {
    position: 'relative',
    marginRight: 8,
  },
  selectedImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeImageText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 12,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  actionButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 20,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
  },
  sendButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Palette.blue,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default MessageScreen;
