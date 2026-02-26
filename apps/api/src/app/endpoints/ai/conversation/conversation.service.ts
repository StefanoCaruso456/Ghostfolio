import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable } from '@nestjs/common';

@Injectable()
export class AiConversationService {
  public constructor(private readonly prismaService: PrismaService) {}

  public async getConversations(userId: string) {
    return this.prismaService.aiConversation.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        createdAt: true,
        id: true,
        title: true,
        updatedAt: true
      },
      where: { userId }
    });
  }

  public async getConversation(id: string, userId: string) {
    return this.prismaService.aiConversation.findFirst({
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            content: true,
            createdAt: true,
            id: true,
            role: true
          }
        }
      },
      where: { id, userId }
    });
  }

  public async createConversation({
    id,
    title,
    userId
  }: {
    id?: string;
    title: string;
    userId: string;
  }) {
    return this.prismaService.aiConversation.create({
      data: {
        ...(id ? { id } : {}),
        title,
        user: { connect: { id: userId } }
      }
    });
  }

  public async updateConversation({
    id,
    title,
    userId
  }: {
    id: string;
    title: string;
    userId: string;
  }) {
    return this.prismaService.aiConversation.updateMany({
      data: { title },
      where: { id, userId }
    });
  }

  public async deleteConversation(id: string, userId: string) {
    return this.prismaService.aiConversation.deleteMany({
      where: { id, userId }
    });
  }

  public async addMessages({
    conversationId,
    messages
  }: {
    conversationId: string;
    messages: { content: string; role: string }[];
  }) {
    return this.prismaService.aiConversationMessage.createMany({
      data: messages.map((m) => ({
        content: m.content,
        conversationId,
        role: m.role
      }))
    });
  }
}
