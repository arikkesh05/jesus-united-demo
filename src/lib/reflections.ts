import { supabase } from '@/lib/supabase';
import { Reflection } from '@/lib/types';

export async function getDailyReflection(): Promise<Reflection | null> {
  const { data, error } = await supabase
    .from('reflections')
    .select('*')
    .order('reflection_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching daily reflection:', error.message);
    return null;
  }

  return data as Reflection;
}
