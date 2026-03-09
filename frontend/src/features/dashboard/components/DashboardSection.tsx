import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReactNode } from 'react';

interface DashboardSectionProps {
  spanClassName: string;
  eyebrow: string;
  title: string;
  description?: ReactNode;
  cardClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}

export function DashboardSection({
  spanClassName,
  eyebrow,
  title,
  description,
  cardClassName,
  contentClassName,
  children,
}: DashboardSectionProps) {
  return (
    <section className={spanClassName}>
      <Card className={cardClassName}>
        <CardHeader>
          <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
            {eyebrow}
          </CardDescription>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className={contentClassName}>{children}</CardContent>
      </Card>
    </section>
  );
}
