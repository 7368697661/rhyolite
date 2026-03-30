import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const documents = await prisma.document.findMany({
    include: {
      timelineEvents: true,
    }
  });

  for (const doc of documents) {
    if (doc.timelineEvents.length > 0) {
      const timeline = await prisma.timeline.create({
        data: {
          title: `Timeline for ${doc.title}`,
          projectId: doc.projectId,
        }
      });

      await prisma.timelineEvent.updateMany({
        where: { documentId: doc.id },
        data: {
          timelineId: timeline.id,
          // We can't set documentId to null here yet if we want to keep it around, but we can set it
          // Wait, documentId is optional now
        }
      });
      
      console.log(`Migrated ${doc.timelineEvents.length} events for ${doc.title} to new Timeline`);
    }
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
