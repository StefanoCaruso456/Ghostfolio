import { UserService } from '@ghostfolio/client/services/user/user.service';
import { AiChatAttachment, User } from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowUpOutline,
  attachOutline,
  chatbubbleEllipsesOutline,
  checkmarkOutline,
  chevronDownOutline,
  closeCircleOutline,
  closeOutline,
  copyOutline,
  createOutline,
  documentOutline,
  imageOutline,
  micOffOutline,
  micOutline,
  pencilOutline,
  refreshOutline,
  sparklesOutline,
  stopCircleOutline,
  trashOutline
} from 'ionicons/icons';
import { MarkdownModule } from 'ngx-markdown';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

interface ChatMessage {
  attachments?: { fileName: string; mimeType: string }[];
  content: string;
  isCopied?: boolean;
  isError?: boolean;
  isLoading?: boolean;
  role: 'assistant' | 'user';
  timestamp: string;
}

interface Conversation {
  id: string;
  messages: ChatMessage[];
  title: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon,
    MarkdownModule,
    MatButtonModule,
    MatTooltipModule
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-ai-chat-sidebar',
  styleUrls: ['./ai-chat-sidebar.component.scss'],
  templateUrl: './ai-chat-sidebar.component.html'
})
export class GfAiChatSidebarComponent implements OnDestroy, OnInit {
  @Input() user: User;

  @Output() closed = new EventEmitter<void>();

  @ViewChild('chatInput') chatInputElement: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInputElement: ElementRef<HTMLInputElement>;
  @ViewChild('messagesContainer')
  messagesContainerElement: ElementRef<HTMLDivElement>;

  public attachments: AiChatAttachment[] = [];
  public conversations: Conversation[] = [];
  public currentConversation: Conversation | null = null;
  public editingConversationId: string | null = null;
  public editingTitle = '';
  public inputValue = '';
  public isGenerating = false;
  public isRecording = false;
  public isSpeechSupported = false;
  public showHistory = false;

  private speechRecognition: any = null;

  private readonly ALLOWED_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'text/csv'
  ];
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  private readonly MAX_FILES = 3;

  public readonly suggestedPrompts = [
    {
      icon: 'sparkles-outline',
      label: $localize`Analyze my portfolio`,
      prompt: 'Analyze my current portfolio allocation, risks, and strengths.'
    },
    {
      icon: 'chatbubble-ellipses-outline',
      label: $localize`Diversification check`,
      prompt:
        'How well diversified is my portfolio? What areas could I improve?'
    },
    {
      icon: 'sparkles-outline',
      label: $localize`Risk assessment`,
      prompt:
        'What are the main risks in my current portfolio and how can I mitigate them?'
    },
    {
      icon: 'chatbubble-ellipses-outline',
      label: $localize`Sector breakdown`,
      prompt:
        'Break down my portfolio by sector and asset class. Are there any imbalances?'
    }
  ];

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private dataService: DataService,
    private userService: UserService
  ) {
    addIcons({
      arrowUpOutline,
      attachOutline,
      chatbubbleEllipsesOutline,
      checkmarkOutline,
      chevronDownOutline,
      closeCircleOutline,
      closeOutline,
      copyOutline,
      createOutline,
      documentOutline,
      imageOutline,
      micOffOutline,
      micOutline,
      pencilOutline,
      refreshOutline,
      sparklesOutline,
      stopCircleOutline,
      trashOutline
    });
  }

  public ngOnInit() {
    this.loadConversations();
    this.initSpeechRecognition();

    this.userService.stateChanged
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((state) => {
        this.user = state.user;
        this.changeDetectorRef.markForCheck();
      });
  }

  public onClose() {
    this.closed.emit();
  }

  public onNewConversation() {
    this.currentConversation = null;
    this.inputValue = '';
    this.attachments = [];
    this.showHistory = false;
    this.changeDetectorRef.markForCheck();
    this.focusInput();
  }

  public onSelectConversation(conversation: Conversation) {
    this.currentConversation = conversation;
    this.showHistory = false;
    this.changeDetectorRef.markForCheck();

    // Load messages from API if not already loaded
    if (conversation.messages.length === 0) {
      this.dataService
        .getAiConversation(conversation.id)
        .pipe(takeUntil(this.unsubscribeSubject))
        .subscribe({
          error: () => {
            // Messages may already be in localStorage cache
          },
          next: (fullConversation) => {
            if (fullConversation?.messages) {
              conversation.messages = fullConversation.messages.map((m) => ({
                content: m.content,
                role: m.role as 'assistant' | 'user',
                timestamp: m.createdAt
              }));
              this.changeDetectorRef.markForCheck();
              this.scrollToBottom();
            }
          }
        });
    } else {
      this.scrollToBottom();
    }
  }

  public onDeleteConversation(event: Event, conversation: Conversation) {
    event.stopPropagation();

    // Optimistic UI update
    this.conversations = this.conversations.filter(
      (c) => c.id !== conversation.id
    );

    if (this.currentConversation?.id === conversation.id) {
      this.currentConversation = null;
    }

    this.saveConversations();
    this.changeDetectorRef.markForCheck();

    // API delete (non-blocking)
    this.dataService
      .deleteAiConversation(conversation.id)
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe();
  }

  public onStartRename(event: Event, conversation: Conversation) {
    event.stopPropagation();
    this.editingConversationId = conversation.id;
    this.editingTitle = conversation.title;
    this.changeDetectorRef.markForCheck();
  }

  public onFinishRename(conversation: Conversation) {
    const newTitle = this.editingTitle.trim();

    if (newTitle && newTitle !== conversation.title) {
      conversation.title = newTitle;
      this.saveConversations();

      // API update (non-blocking)
      this.dataService
        .updateAiConversation(conversation.id, { title: newTitle })
        .pipe(takeUntil(this.unsubscribeSubject))
        .subscribe();
    }

    this.editingConversationId = null;
    this.changeDetectorRef.markForCheck();
  }

  public onCancelRename() {
    this.editingConversationId = null;
    this.changeDetectorRef.markForCheck();
  }

  public onRenameKeydown(event: KeyboardEvent, conversation: Conversation) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onFinishRename(conversation);
    } else if (event.key === 'Escape') {
      this.onCancelRename();
    }
  }

  public onToggleHistory() {
    this.showHistory = !this.showHistory;
    this.changeDetectorRef.markForCheck();
  }

  public onUseSuggestedPrompt(prompt: string) {
    this.inputValue = prompt;
    this.onSendMessage();
  }

  public onSendMessage() {
    const message = this.inputValue.trim();

    if (!message || this.isGenerating) {
      return;
    }

    // Capture and clear attachments + input
    const messageAttachments = [...this.attachments];
    this.inputValue = '';
    this.attachments = [];

    if (!this.currentConversation) {
      this.currentConversation = {
        id: crypto.randomUUID(),
        messages: [],
        title: message.slice(0, 50) + (message.length > 50 ? '...' : '')
      };
      this.conversations.unshift(this.currentConversation);
    }

    const userMessage: ChatMessage = {
      attachments: messageAttachments.length
        ? messageAttachments.map((a) => ({
            fileName: a.fileName,
            mimeType: a.mimeType
          }))
        : undefined,
      content: message,
      role: 'user',
      timestamp: new Date().toISOString()
    };
    this.currentConversation.messages.push(userMessage);

    const loadingMessage: ChatMessage = {
      content: '',
      isLoading: true,
      role: 'assistant',
      timestamp: new Date().toISOString()
    };
    this.currentConversation.messages.push(loadingMessage);

    this.isGenerating = true;
    this.changeDetectorRef.markForCheck();
    this.scrollToBottom();
    this.focusInput();

    const history = this.currentConversation.messages
      .filter((m) => !m.isLoading && !m.isError)
      .slice(0, -1)
      .map((m) => ({ content: m.content, role: m.role }));

    this.dataService
      .chatWithAi({
        attachments: messageAttachments.length
          ? messageAttachments
          : undefined,
        history,
        message,
        conversationId: this.currentConversation.id
      })
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        error: () => {
          const lastMessage =
            this.currentConversation.messages[
              this.currentConversation.messages.length - 1
            ];
          lastMessage.content = $localize`Sorry, I encountered an error. Please try again.`;
          lastMessage.isError = true;
          lastMessage.isLoading = false;

          this.isGenerating = false;
          this.saveConversations();
          this.changeDetectorRef.markForCheck();
          this.focusInput();
        },
        next: (response) => {
          const lastMessage =
            this.currentConversation.messages[
              this.currentConversation.messages.length - 1
            ];
          lastMessage.content = response.message.content;
          lastMessage.isLoading = false;
          lastMessage.timestamp = response.message.timestamp;

          this.isGenerating = false;
          this.saveConversations();
          this.changeDetectorRef.markForCheck();
          this.scrollToBottom();
          this.focusInput();
        }
      });
  }

  public onAttachFile() {
    this.fileInputElement?.nativeElement?.click();
  }

  public onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files?.length) {
      return;
    }

    for (let i = 0; i < files.length; i++) {
      if (this.attachments.length >= this.MAX_FILES) {
        break;
      }

      const file = files[i];

      if (!this.ALLOWED_TYPES.includes(file.type)) {
        continue;
      }

      if (file.size > this.MAX_FILE_SIZE) {
        continue;
      }

      const reader = new FileReader();

      reader.onload = () => {
        const content =
          file.type === 'text/csv'
            ? (reader.result as string)
            : (reader.result as string); // base64 data URL for images/PDFs

        this.attachments.push({
          content,
          fileName: file.name,
          mimeType: file.type,
          size: file.size
        });
        this.changeDetectorRef.markForCheck();
      };

      if (file.type === 'text/csv') {
        reader.readAsText(file);
      } else {
        reader.readAsDataURL(file);
      }
    }

    // Reset input so same file can be re-selected
    input.value = '';
  }

  public onRemoveAttachment(index: number) {
    this.attachments.splice(index, 1);
    this.changeDetectorRef.markForCheck();
  }

  public getAttachmentIcon(mimeType: string): string {
    if (mimeType.startsWith('image/')) {
      return 'image-outline';
    }

    return 'document-outline';
  }

  public formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return bytes + ' B';
    }

    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }

    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  public onCopyMessage(message: ChatMessage) {
    navigator.clipboard.writeText(message.content).then(() => {
      message.isCopied = true;
      this.changeDetectorRef.markForCheck();

      setTimeout(() => {
        message.isCopied = false;
        this.changeDetectorRef.markForCheck();
      }, 2000);
    });
  }

  public onRetryMessage(messageIndex: number) {
    if (!this.currentConversation || this.isGenerating) {
      return;
    }

    // Remove the failed assistant message and the user message before it
    this.currentConversation.messages.splice(messageIndex - 1, 2);
    this.changeDetectorRef.markForCheck();

    // Resend the last user message
    const lastUserMessage = [...this.currentConversation.messages]
      .reverse()
      .find((m) => m.role === 'user');

    if (lastUserMessage) {
      this.inputValue = lastUserMessage.content;
    }
  }

  public onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.onSendMessage();
    }
  }

  public onToggleVoiceInput(): void {
    if (!this.speechRecognition) {
      return;
    }

    if (this.isRecording) {
      this.speechRecognition.stop();
      this.isRecording = false;
    } else {
      this.speechRecognition.start();
      this.isRecording = true;
    }

    this.changeDetectorRef.markForCheck();
  }

  public adjustTextareaHeight(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height =
      Math.min(textarea.scrollHeight, 150) + 'px';
  }

  public trackByIndex(index: number) {
    return index;
  }

  public ngOnDestroy() {
    if (this.speechRecognition && this.isRecording) {
      this.speechRecognition.stop();
    }

    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  private initSpeechRecognition(): void {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      this.isSpeechSupported = false;

      return;
    }

    this.isSpeechSupported = true;
    this.speechRecognition = new SpeechRecognitionCtor();
    this.speechRecognition.continuous = true;
    this.speechRecognition.interimResults = true;
    this.speechRecognition.lang =
      this.user?.settings?.language ?? 'en-US';

    this.speechRecognition.onresult = (event: any) => {
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        this.inputValue +=
          (this.inputValue ? ' ' : '') + finalTranscript.trim();
        this.changeDetectorRef.markForCheck();
      }
    };

    this.speechRecognition.onend = () => {
      this.isRecording = false;
      this.changeDetectorRef.markForCheck();
    };

    this.speechRecognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      this.isRecording = false;
      this.changeDetectorRef.markForCheck();
    };
  }

  private focusInput() {
    setTimeout(() => {
      this.chatInputElement?.nativeElement?.focus();
    });
  }

  private loadConversations() {
    this.dataService
      .getAiConversations()
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        error: () => {
          // Fall back to localStorage
          try {
            const stored = localStorage.getItem('gf-ai-conversations');

            if (stored) {
              this.conversations = JSON.parse(stored);
            }
          } catch {
            this.conversations = [];
          }

          this.changeDetectorRef.markForCheck();
        },
        next: (apiConversations) => {
          this.conversations = apiConversations.map((c) => ({
            id: c.id,
            messages: [],
            title: c.title
          }));
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  private saveConversations() {
    try {
      const toSave = this.conversations.map((c) => ({
        ...c,
        messages: c.messages.filter((m) => !m.isLoading)
      }));
      localStorage.setItem('gf-ai-conversations', JSON.stringify(toSave));
    } catch {
      // Storage full or unavailable
    }
  }

  private scrollToBottom() {
    setTimeout(() => {
      const container = this.messagesContainerElement?.nativeElement;

      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }
}
